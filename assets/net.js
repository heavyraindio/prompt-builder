/* ==========================================================================
   net.js — 只在本地服务 / 上游模型商 / ComfyUI 之间跑数据
   页面别处不许直接 fetch，要发请求都从这里过
   ========================================================================== */
(function (AB) {
  'use strict';

  AB.net = AB.net || {};

  function S() { return AB.state; }

  AB.net.proxyBase = function () {
    return (S().cfg.proxy || AB.DEFAULT_PROXY).replace(/\/+$/, '');
  };

  function postJSON(url, body, extraHeaders) {
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
      body: JSON.stringify(body)
    });
  }
  AB.net.postJSON = postJSON;

  /* ---------------- 服务端连通性 / 配置同步 ---------------- */

  /* 探一次本地服务，顺便把服务端的连接清单并回本地。
     规矩：key 只存本机浏览器（localStorage），服务端那份文件里只有地址和模型。
     老版本把 key 写在 providers.json 里，这里做一次性搬迁：key 搬进本地，再把文件擦干净。 */
  AB.net.bootServer = async function () {
    if (S().cfg.mode !== 'proxy') { S().online = false; return false; }
    try {
      var r = await fetch(AB.net.proxyBase() + '/api/providers', { cache: 'no-store' });
      var j = await r.json();
      var remote = Array.isArray(j.providers) ? j.providers : [];
      S().providers = S().providers || [];
      var added = 0, moved = 0;
      remote.forEach(function (rp) {
        var mine = S().providers.filter(function (x) { return x.id === rp.id; })[0];
        if (!mine) {
          S().providers.push(Object.assign({}, rp));
          added++;
          if (rp.key) moved++;
        } else if (!mine.key && rp.key) {
          mine.key = rp.key;
          moved++;
        }
      });
      if (added || moved) {
        AB.store.set(AB.NS + '_providers', S().providers);
        AB.persist();
        if (moved) {
          await AB.net.pushToServer();                     /* 写回时 key 已经剥掉，文件就干净了 */
          AB.toast('已把 ' + moved + ' 个 key 挪到本机浏览器');
        }
      }
      S().online = true;
    } catch (e) {
      S().online = false;
    }
    return S().online;
  };

  /* 界面外观：开机拉一次对齐，滑块动完写回去（启动器下次启动按这份来） */
  AB.net.uiConf = async function () {
    try {
      var r = await fetch(AB.net.proxyBase() + '/api/ui', { cache: 'no-store' });
      var j = await r.json();
      return (j && !j.error) ? j : null;
    } catch (e) {
      return null;
    }
  };

  AB.net.uiSave = async function (patch) {
    try {
      var r = await postJSON(AB.net.proxyBase() + '/api/ui', patch);
      return await r.json();
    } catch (e) {
      return { error: String(e) };
    }
  };

  /* 把连接清单写回 providers.json —— 只写地址与模型清单，key 不出本机 */
  AB.net.pushToServer = async function () {
    if (S().cfg.mode !== 'proxy') return false;
    try {
      var safe = (S().providers || []).map(function (p) {
        return { id: p.id, name: p.name, api_base: p.api_base,
                 models: p.models, note: p.note, vision: p.vision };
      });
      var r = await postJSON(AB.net.proxyBase() + '/api/providers', { providers: safe });
      return r.ok;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- 模型列表 ---------------- */

  /* 代理模式由服务端代拉（绕 CORS），直连模式浏览器自己打 */
  AB.net.fetchModels = async function (apiBase, key) {
    if (S().cfg.mode === 'proxy' && S().online) {
      var r = await postJSON(AB.net.proxyBase() + '/api/fetch-models', { api_base: apiBase, key: key });
      var j = await r.json();
      if (j.error) throw new Error(j.error);
      return j.models || [];
    }
    var r2 = await fetch(apiBase.replace(/\/+$/, '') + '/models',
      { headers: key ? { Authorization: 'Bearer ' + key } : {} });
    var j2 = await r2.json();
    return (j2.data || j2.models || []).map(function (m) { return m.id || m.name; }).filter(Boolean);
  };

  /* ---------------- 对话 ---------------- */

  /* 流式对话；onDelta(全文) 每次增量都回调一次 */
  AB.net.chat = async function (body, onDelta) {
    var p = AB.clients.current();
    var url, headers = {}, payload = body;

    if (S().cfg.mode === 'direct') {
      url = (p.api_base || '').replace(/\/+$/, '') + '/chat/completions';
      if (p.key) headers['Authorization'] = 'Bearer ' + p.key;
    } else {
      url = AB.net.proxyBase() + '/api/chat';
      payload = Object.assign({ provider: p.id }, body);
      if (p.key) payload.key = p.key;        /* key 只随这一发请求走，不落盘 */
    }

    var res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      var detail = '';
      try { detail = (await res.text()).slice(0, 220); } catch (e) {}
      throw new Error('HTTP ' + res.status + ' ' + detail);
    }

    var ct = res.headers.get('content-type') || '';
    if (!/event-stream/.test(ct)) {                 // 有的上游不吐 SSE
      var j = await res.json();
      var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return c || JSON.stringify(j).slice(0, 300);
    }

    var rd = res.body.getReader(), dec = new TextDecoder();
    var buf = '', full = '', think = '';
    while (true) {
      var step = await rd.read();
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(function (line) {
        var l = line.trim();
        if (l.indexOf('data:') !== 0) return;
        var d = l.slice(5).trim();
        if (!d || d === '[DONE]') return;
        try {
          var o = JSON.parse(d);
          var delta = (o.choices && o.choices[0] && o.choices[0].delta) || {};
          /* 有的模型（推理系）先吐 reasoning_content，正片 content 是 null */
          if (delta.reasoning_content) think += delta.reasoning_content;
          if (delta.content) full += delta.content;
          if (delta.content || delta.reasoning_content) {
            onDelta(full, { thinking: think.length, hasContent: !!full });
          }
        } catch (e) {}
      });
    }
    /* 兜底：只有思考过程没正片时，把思考内容当结果交出来 */
    if (!full && think) {
      onDelta(think, { thinking: think.length, hasContent: true, fallback: true });
      return think;
    }
    return full;
  };

  /* ---------------- 图库（Danbooru） ---------------- */

  /* 透传到服务端的 D 站代理 */
  AB.net.dan = async function (params) {
    var q = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var r = await fetch(AB.net.proxyBase() + '/api/dan?' + q);
    var j = await r.json();
    if (j && j.error) throw new Error(j.error);
    return j;
  };

  /* D 站配置状态（有没有挂代理、有没有填账号） */
  AB.net.danConf = async function () {
    try {
      var r = await fetch(AB.net.proxyBase() + '/api/danconf', { cache: 'no-store' });
      return await r.json();
    } catch (e) {
      return { authed: false, proxy: '', login: '', has_key: false };
    }
  };

  AB.net.danConfSave = async function (conf) {
    var r = await postJSON(AB.net.proxyBase() + '/api/danconf', conf);
    var j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  };

  /* 图片走本地代理（D 站 CDN 直连不通，且这样就没跨域问题） */
  AB.net.danImg = function (u) {
    return AB.net.proxyBase() + '/api/dan/img?u=' + encodeURIComponent(u);
  };

  /* 中断当前这单出图（掐 ComfyUI 的执行 + 清队列） */
  AB.net.comfyInterrupt = async function () {
    var r = await postJSON(AB.net.proxyBase() + '/api/comfy/interrupt', {});
    return await r.json();
  };

  /* 把一张远程图取成 File，直接喂给投喂区 */
  AB.net.danFetchFile = async function (u, name) {
    var r = await fetch(AB.net.danImg(u));
    if (!r.ok) throw new Error('取图失败 HTTP ' + r.status);
    var blob = await r.blob();
    return new File([blob], name || ('dan_' + Date.now() + '.jpg'),
                    { type: blob.type || 'image/jpeg' });
  };

  /* ---------------- 出图 ---------------- */

  /* 把一条提示词交给 ComfyUI，等它出图（可能几十秒） */
  AB.net.comfyGenerate = async function (positive, engine) {
    var r = await postJSON(AB.net.proxyBase() + '/api/comfy/generate',
      { positive: positive, comfy: S().cfg.comfy, engine: engine || 'anima' });
    var j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  };
})(window.AB);
