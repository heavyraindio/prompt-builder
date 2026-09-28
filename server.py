# -*- coding: utf-8 -*-
"""
Anima 反推台 · 本地服务
- 托管 index.html / presets.js
- /api/providers  读写 providers.json（key 只留在服务端，避免浏览器 CORS）
- /api/chat       把请求转发给对应模型商，SSE 流式回传给前端

启动：python server.py [端口]
"""
import json
import mimetypes
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import hashlib
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Server(ThreadingHTTPServer):
    # Windows 下默认的 SO_REUSEADDR 会让两个进程绑同一端口，
    # 于是旧窗口的旧代码会继续抢答。关掉它，冲突就当面报错。
    allow_reuse_address = False
    daemon_threads = True

ROOT = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(ROOT, 'providers.json')
TEMPLATE = os.path.join(ROOT, 'comfy', 'api_template.json')   # 默认（anima）工作流
OUTDIR = os.path.join(ROOT, 'comfy_out')                      # 出图落地目录

# ---------------------------------------------------------------- 出图引擎
# 一个引擎 = 一套 ComfyUI 工作流（都放 comfy/ 下，API 格式）。
# 节点一律**先按标题找**：工作流改版换了 id 也不用动代码；标题对不上才退回 fallback id。
# 提示词字段按 prompt_field 写，那个字段不在就按 PROMPT_FIELDS 的顺序认。
ENGINES = {
    'anima': {
        'file': 'api_template.json',
        'label': 'Anima',
        'prompt_title': 'WeiLin 提示词编辑器', 'prompt_node': '16', 'prompt_field': 'positive',
        'out_titles': ['二采样', '一采样'], 'out_nodes': ['17', '18'],
    },
    'krea2': {
        'file': 'api_krea2_t2i.json',
        'label': 'Krea2 文生图',
        'prompt_title': 'CLIP文本编码', 'prompt_node': '51', 'prompt_field': 'text',
        'out_titles': ['保存图像'], 'out_nodes': ['29'],
    },
    'qwen': {
        'file': 'api_qwen21_t2i.json',
        'label': 'Qwen2.1 文生图',
        'prompt_title': 'Text Encode Qwen Image 2.1', 'prompt_node': '478', 'prompt_field': 'prompt',
        'out_titles': ['保存图像（高级）'], 'out_nodes': ['461'],
    },
}
PROMPT_FIELDS = ('positive', 'text', 'prompt')
DEFAULT_COMFY = 'http://127.0.0.1:8188'
DAN_CACHE = os.path.join(ROOT, 'dan_cache')          # D 站图片缓存
COMFY_CURRENT = {'pid': None}                        # 正在等的那个任务
COMFY_CANCEL = set()                                 # 被要求中断的任务
# 界面外观（启动器写入 providers.json 的 ui 段，前端开机时来取）
UI_DEFAULTS = {
    'bg_opacity': 16,                 # 背景图不透明度，0 到 60
    'bg_image': 'assets/bg.jpg',      # 相对 ROOT 的路径，空 = 不铺背景图
}
DAN_DEFAULTS = {
    'base': 'https://danbooru.donmai.us',
    'proxy': '',            # 例 http://127.0.0.1:7897；留空则直连
    'login': '',            # 可选，填了能突破匿名 2 tag 限制
    'api_key': '',
}
DEFAULT_PORT = 8899


def node_title(node):
    """节点标题：ComfyUI 导出的 API 格式把它放在 _meta.title 里，顺便去掉两头空格。"""
    if not isinstance(node, dict):
        return ''
    return str((node.get('_meta') or {}).get('title') or '').strip()


def find_node(api, titles, fallback_id=None):
    """先按标题逐个试，都不中再落 fallback id。返回 (id, 节点)，找不到是 (None, None)。"""
    for want in titles or []:
        for nid, node in api.items():
            if node_title(node) == want:
                return nid, node
    if fallback_id is not None and isinstance(api.get(str(fallback_id)), dict):
        return str(fallback_id), api[str(fallback_id)]
    return None, None


def load_cfg():
    # 文件不在就当空配置：仓库里不带 providers.json，第一次保存时自动生成
    if not os.path.isfile(CFG_PATH):
        return {}
    with open(CFG_PATH, 'r', encoding='utf-8-sig') as f:
        return json.load(f)


def save_cfg(cfg):
    with open(CFG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'AnimaReverseBench/1.0'

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))
        sys.stderr.flush()

    # ---------------------------------------------------------------- utils
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _send(self, code, body=b'', ctype='application/json; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    # ---------------------------------------------------------------- routes
    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/api/ui':
            return self._json(self._ui_payload())

        if path == '/api/danconf':
            c = self._dan_conf()
            return self._json({
                'proxy': c.get('proxy') or '',
                'login': c.get('login') or '',
                'has_key': bool(c.get('api_key')),
                'authed': bool(c.get('login') and c.get('api_key')),
                'base': c.get('base') or '',
            })

        if path == '/api/dan':
            return self._dan_api(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))

        if path == '/api/dan/img':
            return self._dan_img(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))

        if path == '/api/providers':
            try:
                cfg = load_cfg()
            except Exception as exc:
                return self._json({'error': '读取 providers.json 失败: %s' % exc, 'providers': []}, 500)
            return self._json({'providers': cfg.get('providers', []), 'port': cfg.get('port', DEFAULT_PORT)})

        if path == '/favicon.ico':
            return self._send(204)

        rel = 'index.html' if path in ('/', '/index.html') else path.lstrip('/')
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._json({'error': 'not found'}, 404)

        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if full.endswith('.js'):
            ctype = 'application/javascript; charset=utf-8'
        elif full.endswith('.html'):
            ctype = 'text/html; charset=utf-8'
        elif full.endswith('.css'):
            ctype = 'text/css; charset=utf-8'
        with open(full, 'rb') as f:
            self._send(200, f.read(), ctype)

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        path = self.path.split('?')[0]
        try:
            payload = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            return self._json({'error': '请求体不是合法 JSON'}, 400)

        if path == '/api/providers':
            try:
                cfg = load_cfg()
                if isinstance(payload.get('providers'), list):
                    # key 一律不进这个文件：前端只回传地址与模型清单，这里再兜一道
                    cfg['providers'] = [
                        {k: v for k, v in prov.items() if k != 'key'}
                        for prov in payload['providers'] if isinstance(prov, dict)
                    ]
                save_cfg(cfg)
            except Exception as exc:
                return self._json({'error': str(exc)}, 500)
            return self._json({'ok': True})

        if path == '/api/chat':
            return self._proxy_chat(payload)

        if path == '/api/fetch-models':
            return self._fetch_models(payload)

        if path == '/api/ui':
            return self._ui_save(payload)

        if path == '/api/danconf':
            try:
                cfg = load_cfg()
                d = cfg.get('danbooru') or {}
                for k in ('proxy', 'login', 'api_key', 'base'):
                    if k in payload:
                        d[k] = (payload.get(k) or '').strip()
                cfg['danbooru'] = d
                save_cfg(cfg)
            except Exception as exc:
                return self._json({'error': str(exc)}, 500)
            return self._json({'ok': True})

        if path == '/api/comfy/interrupt':
            return self._comfy_interrupt()

        if path == '/api/comfy/generate':
            return self._comfy_generate(payload)

        return self._json({'error': 'not found'}, 404)

    # ---------------------------------------------------------------- 界面外观
    def _ui_conf(self):
        conf = dict(UI_DEFAULTS)
        try:
            conf.update(load_cfg().get('ui') or {})
        except Exception:
            pass
        return conf

    def _ui_payload(self):
        conf = self._ui_conf()
        img = str(conf.get('bg_image') or '').strip().replace('\\', '/')
        full = os.path.normpath(os.path.join(ROOT, img)) if img else ''
        return {
            'bg_opacity': max(0, min(60, int(conf.get('bg_opacity') or 0))),
            'bg_image': img,
            'bg_exists': bool(img) and full.startswith(ROOT) and os.path.isfile(full),
        }

    def _ui_save(self, payload):
        try:
            cfg = load_cfg()
        except Exception as exc:
            return self._json({'error': str(exc)}, 500)
        ui = cfg.get('ui') or {}
        if 'bg_opacity' in payload:
            try:
                ui['bg_opacity'] = max(0, min(60, int(payload.get('bg_opacity') or 0)))
            except Exception:
                pass
        if 'bg_image' in payload:
            img = str(payload.get('bg_image') or '').strip().replace('\\', '/')
            if img:
                full = os.path.normpath(os.path.join(ROOT, img))
                if not full.startswith(ROOT):
                    return self._json({'error': '背景图路径只能放在本目录里'}, 400)
                if not os.path.isfile(full):
                    return self._json({'error': '找不到这个图片：%s' % img}, 400)
            ui['bg_image'] = img
        cfg['ui'] = ui
        try:
            save_cfg(cfg)
        except Exception as exc:
            return self._json({'error': str(exc)}, 500)
        return self._json({'ok': True, 'ui': self._ui_payload()})

    # ---------------------------------------------------------------- danbooru
    def _dan_conf(self):
        conf = dict(DAN_DEFAULTS)
        try:
            conf.update(load_cfg().get('danbooru') or {})
        except Exception:
            pass
        return conf

    def _dan_open(self, url, timeout=30):
        conf = self._dan_conf()
        handlers = [urllib.request.ProxyHandler(
            {'http': conf['proxy'], 'https': conf['proxy']} if conf.get('proxy') else {})]
        op = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, headers={
            'User-Agent': 'AnimaBench/1.0 (local tool)',
            'Accept': '*/*',
        })
        return op.open(req, timeout=timeout)

    def _dan_api(self, q):
        api = (q.get('api') or ['posts'])[0]
        if api not in ('tags', 'posts', 'counts', 'tag_implications'):
            return self._json({'error': '不支持的接口: %s' % api}, 400)

        conf = self._dan_conf()
        params = {}
        for k, v in q.items():
            if k == 'api':
                continue
            params[k] = v[0]
        if conf.get('login') and conf.get('api_key'):
            params['login'] = conf['login']
            params['api_key'] = conf['api_key']

        if api == 'counts':
            endpoint = 'counts/posts.json'          # D 站的计数接口在这个路径下
        else:
            endpoint = api + '.json'
        url = conf['base'].rstrip('/') + '/' + endpoint + '?' + urllib.parse.urlencode(params)
        try:
            raw = self._dan_open(url, timeout=25).read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', 'ignore')[:300]
            return self._json({'error': 'D 站返回 %s: %s' % (exc.code, detail)}, 502)
        except Exception as exc:
            return self._json({
                'error': '连不上 D 站：%s。多半是没挂代理 —— 在 providers.json 的 danbooru.proxy 里填上你的代理端口。' % exc
            }, 502)
        try:
            return self._send(200, raw, 'application/json; charset=utf-8')
        except Exception as exc:
            return self._json({'error': str(exc)}, 500)

    def _dan_img(self, q):
        u = (q.get('u') or [''])[0]
        if not u:
            return self._json({'error': '缺少图片地址'}, 400)
        host = urllib.parse.urlparse(u).hostname or ''
        if not (host.endswith('donmai.us')):                 # 只代理由 D 站域名来的图
            return self._json({'error': '只代理 D 站域名下的图片'}, 403)

        ext = os.path.splitext(urllib.parse.urlparse(u).path)[1] or '.jpg'
        name = hashlib.md5(u.encode('utf-8')).hexdigest() + ext
        path = os.path.join(DAN_CACHE, name)
        if os.path.isfile(path):
            with open(path, 'rb') as f:
                return self._send(200, f.read(), mimetypes.guess_type(name)[0] or 'image/jpeg')

        try:
            data = self._dan_open(u, timeout=60).read()
        except Exception as exc:
            return self._json({'error': '取图失败: %s' % exc}, 502)
        try:
            os.makedirs(DAN_CACHE, exist_ok=True)
            with open(path, 'wb') as f:
                f.write(data)
        except Exception:
            pass
        return self._send(200, data, mimetypes.guess_type(name)[0] or 'image/jpeg')

    # ---------------------------------------------------------------- comfyui
    def _comfy_generate(self, payload):
        positive = (payload.get('positive') or '').strip()
        if not positive:
            return self._json({'error': '提示词是空的'}, 400)

        # 用哪套工作流：前端把引擎名带过来，缺省还是 anima 那套
        eng_key = str(payload.get('engine') or 'anima').strip().lower()
        if eng_key not in ENGINES:
            eng_key = 'anima'
        eng = ENGINES[eng_key]

        try:
            base = (payload.get('comfy') or load_cfg().get('comfy_base') or DEFAULT_COMFY).rstrip('/')
        except Exception:
            base = DEFAULT_COMFY

        tpl = os.path.join(ROOT, 'comfy', eng['file'])
        if not os.path.isfile(tpl):
            return self._json({'error': '缺 comfy/%s —— 先在 ComfyUI 里导出这份工作流的 API 格式放进去' % eng['file']}, 500)
        try:
            with open(tpl, 'r', encoding='utf-8') as f:
                api = json.load(f)
        except Exception as exc:
            return self._json({'error': '工作流 %s 读取失败: %s' % (eng['file'], exc)}, 500)

        # 提示词入口：先按标题认，认不到再按配置里的 fallback id
        node_id, node = find_node(api, [eng['prompt_title']], eng.get('prompt_node'))
        if node is None:
            return self._json({'error': '%s 里找不到标题为「%s」的提示词节点' % (eng['file'], eng['prompt_title'])}, 500)
        inputs = node.get('inputs') or {}
        field = eng['prompt_field'] if eng['prompt_field'] in inputs else ''
        if not field:
            field = next((f for f in PROMPT_FIELDS if f in inputs), '')
        if not field:
            return self._json({'error': '%s 的提示词节点 %s 里没有可写的字段（找过 %s）'
                               % (eng['file'], node_id, ' / '.join(PROMPT_FIELDS))}, 500)
        node['inputs'][field] = positive

        # 成品出口：同样按标题认
        out_id, _out = find_node(api, eng.get('out_titles') or [], (eng.get('out_nodes') or [None])[0])

        body = json.dumps({'prompt': api, 'client_id': 'anima-reverse-bench'}).encode('utf-8')
        req = urllib.request.Request(base + '/prompt', data=body,
                                     headers={'Content-Type': 'application/json'})
        try:
            res = json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore'))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', 'ignore')[:400]
            return self._json({'error': 'ComfyUI 拒绝了这个任务: %s' % detail}, 502)
        except Exception as exc:
            return self._json({'error': '连不上 ComfyUI（请先打开 ComfyUI）: %s' % exc}, 502)

        pid = res.get('prompt_id')
        if not pid:
            return self._json({'error': 'ComfyUI 没回 prompt_id: %s' % str(res)[:200]}, 502)

        COMFY_CURRENT['pid'] = pid
        deadline = time.time() + 600
        while time.time() < deadline:
            time.sleep(1.5)

            if pid in COMFY_CANCEL:
                COMFY_CANCEL.discard(pid)
                COMFY_CURRENT['pid'] = None
                return self._json({'error': '已中断', 'cancelled': True})
            try:
                hist = json.loads(urllib.request.urlopen(
                    base + '/history/' + pid, timeout=20).read().decode('utf-8', 'ignore'))
            except Exception:
                continue
            item = hist.get(pid)
            if not item:
                continue

            status = item.get('status') or {}
            if status.get('status_str') == 'error':
                return self._json({'error': 'ComfyUI 执行报错: %s' % json.dumps(
                    status.get('messages', status), ensure_ascii=False)[:300]}, 502)

            outs = item.get('outputs') or {}
            imgs = None
            # 认到的那个出口优先，其次配置里的 fallback id，最后谁有图算谁的
            if out_id and isinstance(outs.get(out_id), dict) and outs[out_id].get('images'):
                imgs = outs[out_id]['images']
            if not imgs:
                for nid in (eng.get('out_nodes') or []):
                    if isinstance(outs.get(nid), dict) and outs[nid].get('images'):
                        imgs = outs[nid]['images']
                        break
            if not imgs:
                for v in outs.values():
                    if isinstance(v, dict) and v.get('images'):
                        imgs = v['images']
                        break
            if not imgs:
                continue

            im = imgs[0]
            q = urllib.parse.urlencode({
                'filename': im.get('filename', ''),
                'subfolder': im.get('subfolder', ''),
                'type': im.get('type', 'output'),
            })
            try:
                data = urllib.request.urlopen(base + '/view?' + q, timeout=60).read()
            except Exception as exc:
                return self._json({'error': '取图失败: %s' % exc}, 502)

            os.makedirs(OUTDIR, exist_ok=True)
            name = 'comfy_%s_%03d.png' % (time.strftime('%Y%m%d_%H%M%S'), int(time.time() * 1000) % 1000)
            with open(os.path.join(OUTDIR, name), 'wb') as f:
                f.write(data)
            COMFY_CURRENT['pid'] = None
            return self._json({'ok': True, 'file': 'comfy_out/' + name,
                               'url': '/comfy_out/' + name, 'source': im.get('filename'),
                               'engine': eng_key, 'engine_label': eng['label'],
                               'prompt_node': node_id, 'prompt_field': field})

        COMFY_CURRENT['pid'] = None
        return self._json({'error': '等了 10 分钟还没出图'}, 504)

    def _comfy_interrupt(self):
        pid = COMFY_CURRENT.get('pid')
        try:
            base = (load_cfg().get('comfy_base') or DEFAULT_COMFY).rstrip('/')
        except Exception:
            base = DEFAULT_COMFY

        # 1) 掐掉正在跑的那一个
        try:
            req = urllib.request.Request(base + '/interrupt', data=b'', method='POST')
            urllib.request.urlopen(req, timeout=10).read()
        except Exception:
            pass

        # 2) 把还排在队里的删掉
        if pid:
            try:
                body = json.dumps({'delete': [pid]}).encode('utf-8')
                req = urllib.request.Request(base + '/queue', data=body, method='POST',
                                             headers={'Content-Type': 'application/json'})
                urllib.request.urlopen(req, timeout=10).read()
            except Exception:
                pass
            COMFY_CANCEL.add(pid)

        return self._json({'ok': True, 'pid': pid})

    # ---------------------------------------------------------------- models
    def _fetch_models(self, payload):
        base = (payload.get('api_base') or '').strip().rstrip('/')
        key = (payload.get('key') or '').strip()
        if not base:
            return self._json({'error': '没填接口地址'}, 400)

        candidates = [base + '/models']
        if not base.endswith('/v1'):
            candidates.append(base + '/v1/models')

        last_err = ''
        for url in candidates:
            headers = {'Accept': 'application/json'}
            if key:
                headers['Authorization'] = 'Bearer ' + key
            try:
                req = urllib.request.Request(url, headers=headers)
                resp = urllib.request.urlopen(req, timeout=30)
                data = json.loads(resp.read().decode('utf-8', 'ignore'))
            except urllib.error.HTTPError as exc:
                last_err = '上游 %s: %s' % (exc.code, exc.read().decode('utf-8', 'ignore')[:200])
                continue
            except Exception as exc:
                last_err = '连不上 %s: %s' % (url, exc)
                continue

            items = data.get('data') or data.get('models') or []
            models = []
            for m in items:
                mid = (m.get('id') or m.get('name')) if isinstance(m, dict) else str(m)
                if mid:
                    models.append(str(mid))
            if not models:
                last_err = '模型列表为空，返回内容：' + str(data)[:180]
                continue
            models = sorted(set(models))
            return self._json({'models': models, 'used_base': url[:-len('/models')]})

        return self._json({'error': last_err or '拉取失败'}, 502)

    # ---------------------------------------------------------------- proxy
    def _proxy_chat(self, payload):
        pid = payload.get('provider')
        try:
            cfg = load_cfg()
        except Exception as exc:
            return self._json({'error': '读取 providers.json 失败: %s' % exc}, 500)

        prov = next((p for p in cfg.get('providers', []) if p.get('id') == pid), None)
        if prov is None:
            return self._json({'error': '未知模型商: %s' % pid}, 400)

        base = (prov.get('api_base') or '').rstrip('/')
        if not base:
            return self._json({'error': '模型商 %s 没填 api_base' % pid}, 400)
        url = base + '/chat/completions'

        # key 由浏览器随请求带上来（本地保存），文件里那份只当老配置的兜底
        upkey = str(payload.get('key') or '').strip()
        body = {k: v for k, v in payload.items() if k not in ('provider', 'key')}
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream, application/json',
        }
        use_key = upkey or str(prov.get('key') or '')
        if use_key:
            headers['Authorization'] = 'Bearer ' + use_key

        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', 'ignore')[:400]
            return self._json({'error': '上游 %s 返回 %s: %s' % (pid, exc.code, detail)}, 502)
        except Exception as exc:
            return self._json({'error': '连不上上游 %s: %s' % (url, exc)}, 502)

        ctype = resp.headers.get('Content-Type', 'application/json')

        # 流式：原样透传（chunked 编码回给浏览器）
        if 'event-stream' in ctype:
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Transfer-Encoding', 'chunked')
            self._cors()
            self.end_headers()
            try:
                while True:
                    chunk = resp.read(1024)
                    if not chunk:
                        break
                    self.wfile.write(('%X\r\n' % len(chunk)).encode() + chunk + b'\r\n')
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                sys.stderr.write('  转发中断: %s\n' % exc)
            finally:
                try:
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()
                except Exception:
                    pass
            return

        # 非流式：一次性转发
        try:
            data = resp.read()
        except Exception as exc:
            return self._json({'error': '读取上游响应失败: %s' % exc}, 502)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)


def port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.6)
    try:
        return s.connect_ex(('127.0.0.1', port)) == 0
    finally:
        s.close()


def main():
    port = DEFAULT_PORT
    try:
        port = int(load_cfg().get('port', DEFAULT_PORT))
    except Exception:
        pass
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except Exception:
            pass

    if port_in_use(port):
        print('')
        print('  [!] 端口 %d 已经被占用了。' % port)
        print('      多半是上一次的服务窗口还开着 —— 把它关掉再双击 start.bat。')
        print('      或者换个端口跑：  python server.py 8900')
        print('')
        return

    try:
        srv = Server(('127.0.0.1', port), Handler)
    except OSError as exc:
        print('')
        print('  [!] 起不来: %s' % exc)
        print('')
        return

    # 端口已绑定成功，再等一小会儿拉浏览器，避免「拒绝连接」
    if os.environ.get('ANIMA_NO_BROWSER') != '1':
        def _open_browser():
            try:
                import webbrowser
                webbrowser.open('http://127.0.0.1:%d' % port)
            except Exception:
                pass
        threading.Timer(1.2, _open_browser).start()
    print('')
    print('  Anima 反推台  ·  咕咕嘎嘎')
    print('  ----------------------------------------')
    print('  打开:  http://127.0.0.1:%d' % port)
    print('  配置:  %s' % CFG_PATH)
    print('  关闭这个窗口即停止服务')
    print('')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n  已停止')
        srv.server_close()


if __name__ == '__main__':
    main()
