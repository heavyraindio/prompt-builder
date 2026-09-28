# -*- coding: utf-8 -*-
"""==========================================================================
Anima 反推台 · 本地启动器
- 点「开始」= 起本地服务，日志就在窗口里看，不弹黑框
- 背景图与不透明度在这儿调，写进 providers.json，网页一刷新就跟着变
- 界面浅蓝，白卡片，克制为上
=========================================================================="""
import importlib.util
import json

# 下面这几个是给 PyInstaller 看的：server.py 是启动时用 importlib 动态载进来的，
# 打包器扫不到它的依赖，漏一个就会报 No module named 'http.server' 这类错
import email                # noqa: F401  http.server 的间接依赖
import hashlib              # noqa: F401  D 站图片缓存名
import http.server          # noqa: F401  服务本体
import mimetypes            # noqa: F401  静态文件类型
import socket               # noqa: F401  占端口检查
import socketserver         # noqa: F401  ThreadingHTTPServer 的底
import urllib.error         # noqa: F401  上游报错处理
import urllib.parse         # noqa: F401  D 站查询串
import os
import queue
import shutil
import sys
import threading
import urllib.request
import webbrowser
import tkinter as tk
from tkinter import filedialog

# 冻结成 exe 后 argv[0] 才是真身，源码跑的时候用 __file__
APP_DIR = os.path.dirname(os.path.abspath(sys.argv[0] if getattr(sys, 'frozen', False) else __file__))

# ------------------------------------------------ 配色（浅蓝）
BG      = '#eef5fc'
CARD    = '#ffffff'
LINE    = '#cfe0f2'
LINE_HI = '#a8c8e6'
INK     = '#12314e'
INK_DIM = '#5f7f9c'
ACC     = '#2f7ec4'
ACC_HI  = '#1f66a8'
OK      = '#2f9e70'
WARN    = '#c9803a'
BAD     = '#c9522f'
LOG_BG  = '#f7fbff'

DEFAULT_PORT = 8899
UI_DEFAULTS = {'bg_opacity': 16, 'bg_image': 'assets/bg.jpg'}


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Anima 反推台 · 启动器')
        self.configure(bg=BG)
        self.geometry('780x560')
        self.minsize(700, 500)

        self.srv = None
        self.thread = None
        self.mod = None                      # 动态载入的 server 模块
        self.sink = None
        self._save_job = None
        self.q = queue.Queue()               # 子线程 → 主线程的单行道

        self._set_icon()
        self._load_cfg()
        self._build()
        self.protocol('WM_DELETE_WINDOW', self._on_close)
        self._pump()                          # 主线程定时取消息，起泵
        self.log('启动器就绪。点「开始」起服务，日志会打在这里。\n')

    # ------------------------------------------------------------ 图标
    def _set_icon(self):
        """窗口/任务栏图标：assets/icon.png（exe 自己的图标是打包时 --icon 塞进去的）"""
        path = os.path.join(APP_DIR, 'assets', 'icon.png')
        if not os.path.isfile(path):
            return
        try:
            self._icon_img = tk.PhotoImage(file=path)   # 必须留着引用，不然会被回收
            self.iconphoto(True, self._icon_img)
        except Exception:
            pass

    # ------------------------------------------------------------ 配置
    def cfg_path(self):
        return os.path.join(APP_DIR, 'providers.json')

    def _load_cfg(self):
        self.cfg = {}
        try:
            with open(self.cfg_path(), 'r', encoding='utf-8-sig') as f:
                self.cfg = json.load(f) or {}
        except Exception:
            self.cfg = {}
        self.ui = dict(UI_DEFAULTS, **(self.cfg.get('ui') or {}))
        self.port = int(self.cfg.get('port') or DEFAULT_PORT)
        self.BG_IMAGE = str(self.ui.get('bg_image') or '')
        self.BG_OPACITY = max(0, min(60, int(self.ui.get('bg_opacity') or 0)))

    def _save_cfg(self, note=''):
        self.cfg['ui'] = {'bg_opacity': int(self.BG_OPACITY), 'bg_image': self.BG_IMAGE}
        self.cfg['port'] = int(self.port)
        try:
            with open(self.cfg_path(), 'w', encoding='utf-8') as f:
                json.dump(self.cfg, f, ensure_ascii=False, indent=2)
            if note:
                self.log(note)
            return True
        except Exception as exc:
            self.log('[X] 写 providers.json 失败：%s\n' % exc)
            return False

    def _push_ui(self):
        """服务在跑的话顺手推一把，网页不用刷新也能变"""
        if not self.srv:
            return
        try:
            body = json.dumps({'bg_opacity': int(self.BG_OPACITY), 'bg_image': self.BG_IMAGE or ''}).encode()
            req = urllib.request.Request('http://127.0.0.1:%d/api/ui' % self.port, data=body,
                                         headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=1.5).read()
        except Exception:
            pass

    # ------------------------------------------------------------ 界面
    def _btn(self, parent, text, cmd, primary=False, width=10):
        b = tk.Button(parent, text=text, command=cmd, width=width,
                      font=('Microsoft YaHei UI', 10, 'bold' if primary else 'normal'),
                      bg=ACC if primary else CARD, fg='#ffffff' if primary else INK,
                      activebackground=ACC_HI if primary else '#e7f0fa',
                      activeforeground='#ffffff' if primary else INK,
                      relief='flat', bd=0, highlightthickness=1,
                      highlightbackground=ACC if primary else LINE,
                      highlightcolor=ACC, cursor='hand2', padx=10, pady=6)
        b.bind('<Enter>', lambda e: b.configure(bg=ACC_HI if primary else '#eaf3fb'))
        b.bind('<Leave>', lambda e: b.configure(bg=ACC if primary else CARD))
        return b

    def _card(self, parent):
        f = tk.Frame(parent, bg=CARD, highlightthickness=1, highlightbackground=LINE)
        return f

    def _build(self):
        # ---- 顶栏 ----
        head = tk.Frame(self, bg=BG)
        head.pack(fill='x', padx=18, pady=(16, 10))
        tk.Label(head, text='ANIMA', bg=BG, fg=INK,
                 font=('Saira', 20, 'bold')).pack(side='left')
        tk.Label(head, text='/ 反推台 · 启动器', bg=BG, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 10)).pack(side='left', padx=(6, 0), pady=(6, 0))
        self.pill = tk.Label(head, text=' 未启动 ', bg='#e3edf7', fg=INK_DIM,
                             font=('Microsoft YaHei UI', 9), padx=8, pady=3)
        self.pill.pack(side='right')

        # ---- 操作条 ----
        bar = tk.Frame(self, bg=BG)
        bar.pack(fill='x', padx=18)
        self.bStart = self._btn(bar, '开始', self.start, primary=True, width=8)
        self.bStart.pack(side='left')
        self.bStop = self._btn(bar, '停止', self.stop, width=8)
        self.bStop.pack(side='left', padx=8)
        self.bOpen = self._btn(bar, '打开工作台', lambda: self.open_page(), width=12)
        self.bOpen.pack(side='left')
        tk.Label(bar, text='端口', bg=BG, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 9)).pack(side='left', padx=(16, 4))
        self.ePort = tk.Entry(bar, width=7, justify='center', font=('Consolas', 10),
                              bg=CARD, fg=INK, relief='flat', highlightthickness=1,
                              highlightbackground=LINE, highlightcolor=ACC)
        self.ePort.insert(0, str(self.port))
        self.ePort.pack(side='left', ipady=4)

        # ---- 主体：左边外观设置，右边日志 ----
        body = tk.Frame(self, bg=BG)
        body.pack(fill='both', expand=True, padx=18, pady=12)

        left = self._card(body)
        left.configure(width=258)
        left.pack(side='left', fill='y')
        left.pack_propagate(False)
        self._build_ui_panel(left)

        right = self._card(body)
        right.pack(side='left', fill='both', expand=True, padx=(12, 0))
        self._build_log_panel(right)

    def _build_ui_panel(self, box):
        tk.Label(box, text='网页外观', bg=CARD, fg=INK,
                 font=('Microsoft YaHei UI', 11, 'bold')).pack(anchor='w', padx=14, pady=(14, 2))
        tk.Label(box, text='改完存进 providers.json，刷新页面就生效', bg=CARD, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 8), wraplength=214, justify='left').pack(anchor='w', padx=14)

        tk.Frame(box, bg=LINE, height=1).pack(fill='x', padx=14, pady=12)

        tk.Label(box, text='背景图', bg=CARD, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 9)).pack(anchor='w', padx=14)
        self.lblBg = tk.Label(box, text=self._bg_name(), bg=CARD, fg=INK, wraplength=214,
                              justify='left', font=('Consolas', 9))
        self.lblBg.pack(anchor='w', padx=14, pady=(3, 8))
        row = tk.Frame(box, bg=CARD)
        row.pack(anchor='w', padx=14)
        self._btn(row, '选图片', self.pick_bg, width=8).pack(side='left')
        self._btn(row, '恢复默认', self.reset_bg, width=9).pack(side='left', padx=6)

        tk.Frame(box, bg=LINE, height=1).pack(fill='x', padx=14, pady=14)

        tk.Label(box, text='不透明度', bg=CARD, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 9)).pack(anchor='w', padx=14)
        self.lblOp = tk.Label(box, text='%d%%' % self.BG_OPACITY, bg=CARD, fg=ACC,
                              font=('Saira', 15, 'bold'))
        self.lblOp.pack(anchor='w', padx=14)
        self.sOp = tk.Scale(box, from_=0, to=60, orient='horizontal', showvalue=0,
                            bg=CARD, fg=INK, troughcolor='#e2eefa', activebackground=ACC,
                            highlightthickness=0, bd=0, sliderrelief='flat',
                            length=214, command=self._on_slider)
        self.sOp.set(self.BG_OPACITY)
        self.sOp.pack(anchor='w', padx=12, pady=(2, 0))
        tk.Label(box, text='0 = 纯底色，60 = 图很显', bg=CARD, fg=INK_DIM,
                 font=('Microsoft YaHei UI', 8)).pack(anchor='w', padx=14)

        tk.Frame(box, bg=LINE, height=1).pack(fill='x', padx=14, pady=14)
        self._btn(box, '保存设置', self.save_ui, primary=True, width=14).pack(anchor='w', padx=14)

    def _build_log_panel(self, box):
        head = tk.Frame(box, bg=CARD)
        head.pack(fill='x', padx=14, pady=(12, 6))
        tk.Label(head, text='运行日志', bg=CARD, fg=INK,
                 font=('Microsoft YaHei UI', 11, 'bold')).pack(side='left')
        self._btn(head, '清空', self.clear_log, width=6).pack(side='right')

        wrap = tk.Frame(box, bg=LINE, highlightthickness=0)
        wrap.pack(fill='both', expand=True, padx=14, pady=(0, 14))
        self.txt = tk.Text(wrap, bg=LOG_BG, fg=INK, insertbackground=ACC, wrap='word',
                           relief='flat', bd=0, padx=10, pady=8,
                           font=('Consolas', 9), state='disabled')
        sb = tk.Scrollbar(wrap, command=self.txt.yview, width=10, relief='flat',
                          bg=CARD, troughcolor=LOG_BG, activebackground=LINE_HI)
        self.txt.configure(yscrollcommand=sb.set)
        sb.pack(side='right', fill='y')
        self.txt.pack(side='left', fill='both', expand=True)

    # ------------------------------------------------------------ 日志
    # Tk 控件只有主线程能碰。子线程（服务在那边跑）要写日志、改状态灯，
    # 一律塞进队列，主线程的 _pump 定时来取 —— 子线程直接调 Tk 会锁死。
    def _pump(self):
        try:
            while True:
                m = self.q.get_nowait()
                if m[0] == 'log':
                    self._log_now(m[1])
                elif m[0] == 'pill':
                    self._pill_now(m[1], m[2], m[3])
        except queue.Empty:
            pass
        self._pump_job = self.after(120, self._pump)

    def log(self, s):
        if s:
            self.q.put(('log', s))

    def _log_now(self, s):
        self.txt.configure(state='normal')
        self.txt.insert('end', s)
        self.txt.see('end')
        self.txt.configure(state='disabled')

    def clear_log(self):
        self.txt.configure(state='normal')
        self.txt.delete('1.0', 'end')
        self.txt.configure(state='disabled')

    def set_pill(self, text, fg, bg):
        self.q.put(('pill', text, fg, bg))

    def _pill_now(self, text, fg, bg):
        self.pill.configure(text=' %s ' % text, fg=fg, bg=bg)

    # ------------------------------------------------------------ 服务
    def load_server(self):
        if self.mod is not None:
            return self.mod
        path = os.path.join(APP_DIR, 'server.py')
        if not os.path.isfile(path):
            self.log('[X] 同目录下找不到 server.py，启动器要跟它放一块。\n')
            return None
        try:
            spec = importlib.util.spec_from_file_location('anima_server', path)
            m = importlib.util.module_from_spec(spec)
            sys.modules['anima_server'] = m
            spec.loader.exec_module(m)
            # 保证路径都指向启动器所在目录，冻结后在临时目录解包也不会迷路
            m.ROOT = APP_DIR
            m.CFG_PATH = os.path.join(APP_DIR, 'providers.json')
            m.OUTDIR = os.path.join(APP_DIR, 'comfy_out')
            m.DAN_CACHE = os.path.join(APP_DIR, 'dan_cache')
            self.mod = m
            return m
        except Exception as exc:
            self.log('[X] 载入 server.py 出错：%s\n' % exc)
            return None

    def start(self):
        if self.thread and self.thread.is_alive():
            self.log('· 服务已经在跑了。\n')
            return
        try:
            self.port = int(self.ePort.get().strip() or DEFAULT_PORT)
        except Exception:
            self.log('[X] 端口得是数字。\n')
            return
        self._save_cfg()

        m = self.load_server()
        if m is None:
            return
        if m.port_in_use(self.port):
            self.log('[X] 端口 %d 已经被占了 —— 多半是上一个服务窗口还开着，\n'
                     '    把它关掉，或换个端口再点开始。\n' % self.port)
            self.set_pill('端口占用', BAD, '#fbe7e2')
            return

        self.sink = LogSink(self)
        sys.stdout = self.sink
        sys.stderr = self.sink

        def run():
            try:
                srv = m.Server(('127.0.0.1', self.port), m.Handler)
            except OSError as exc:
                self.log('[X] 起不来：%s\n' % exc)
                self.set_pill('起不来', BAD, '#fbe7e2')
                return
            self.srv = srv
            self.set_pill('运行中 :%d' % self.port, OK, '#e2f4ec')
            self.log('· 服务已起来： http://127.0.0.1:%d\n' % self.port)
            webbrowser.open('http://127.0.0.1:%d' % self.port)
            try:
                srv.serve_forever()
            except Exception as exc:
                self.log('[X] 服务异常退出：%s\n' % exc)
            finally:
                try:
                    srv.server_close()
                except Exception:
                    pass
                self.srv = None
                self.set_pill('已停止', INK_DIM, '#e3edf7')
                self.log('· 服务已停止。\n')

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def stop(self):
        if not self.srv:
            self.log('· 服务本来就没在跑。\n')
            return
        self.log('· 正在停服务…\n')
        try:
            self.srv.shutdown()
        except Exception as exc:
            self.log('  停止时出错：%s\n' % exc)

    def open_page(self):
        if not self.srv:
            self.log('· 服务没起呢，先点「开始」。\n')
            return
        webbrowser.open('http://127.0.0.1:%d' % self.port)

    # ------------------------------------------------------------ 外观设置
    def _bg_name(self):
        if not self.BG_IMAGE:
            return '（不铺背景图）'
        if os.path.isfile(os.path.join(APP_DIR, self.BG_IMAGE)):
            return self.BG_IMAGE
        return self.BG_IMAGE + '  （文件不在，已回落默认）'

    def pick_bg(self):
        p = filedialog.askopenfilename(
            title='挑一张背景图',
            filetypes=[('图片', '*.jpg *.jpeg *.png *.webp *.bmp'), ('所有文件', '*.*')])
        if not p:
            return
        ext = os.path.splitext(p)[1].lower() or '.jpg'
        dst_dir = os.path.join(APP_DIR, 'assets')
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, 'bg_custom' + ext)
        try:
            shutil.copyfile(p, dst)
        except Exception as exc:
            self.log('[X] 拷图失败：%s\n' % exc)
            return
        self.BG_IMAGE = 'assets/bg_custom' + ext
        self.lblBg.configure(text=self._bg_name())
        self.log('· 背景图换成 %s\n' % self.BG_IMAGE)
        self.save_ui()

    def reset_bg(self):
        self.BG_IMAGE = 'assets/bg.jpg'
        self.lblBg.configure(text=self._bg_name())
        self.log('· 背景图回到默认 assets/bg.jpg\n')
        self.save_ui()

    def _on_slider(self, v):
        self.BG_OPACITY = max(0, min(60, int(float(v))))
        self.lblOp.configure(text='%d%%' % self.BG_OPACITY)
        if self._save_job:
            self.after_cancel(self._save_job)
        self._save_job = self.after(350, self.save_ui)      # 拖的时候别狂写盘

    def save_ui(self):
        self._save_job = None
        if self._save_cfg():
            self._push_ui()
            self.log('· 已保存：背景图 %s · 不透明度 %d%%\n' % (self._bg_name(), self.BG_OPACITY))

    # ------------------------------------------------------------ 收尾
    def _on_close(self):
        if self.srv:
            try:
                self.srv.shutdown()
                self.srv.server_close()
            except Exception:
                pass
        self.destroy()


class LogSink:
    """把 server.py 的 print / stderr 接进日志框。
    这里在服务线程里被调用，只能往队列里塞，不能碰 Tk。"""

    def __init__(self, gui):
        self.gui = gui

    def write(self, s):
        if s:
            self.gui.q.put(('log', s))

    def flush(self):
        pass

    def isatty(self):
        return False


def _selftest():
    """打包后自检：在 exe 里把服务起一把，结果写 _selftest.txt。
    窗口版（--noconsole）没有 stdout，所以不能靠 print。"""
    import time
    import urllib.request
    out = []
    app = Launcher()
    app.withdraw()
    app.ePort.delete(0, 'end')
    app.ePort.insert(0, '8917')
    app.start()
    for _ in range(30):
        app.update()
        time.sleep(0.1)
    ok = False
    try:
        j = json.loads(urllib.request.urlopen('http://127.0.0.1:8917/api/ui', timeout=5).read())
        ok = isinstance(j, dict)
        out.append('api/ui -> %s' % j)
    except Exception as exc:
        out.append('api/ui 失败: %s' % exc)
    out.append('状态灯: %s' % app.pill.cget('text'))
    out.append('日志尾巴: %s' % app.txt.get('1.0', 'end')[-400:].replace('\n', ' | '))
    app.stop()
    for _ in range(15):
        app.update()
        time.sleep(0.1)
    app.destroy()
    try:
        with open(os.path.join(APP_DIR, '_selftest.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(out))
    except Exception:
        pass
    return ok


if __name__ == '__main__':
    # 窗口版模式下这两个是 None，任何 print 都会炸，先兜住
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')
    if '--selftest' in sys.argv:
        sys.exit(0 if _selftest() else 1)
    Launcher().mainloop()
