/* ==========================================================================
   core.js — 命名空间、全局状态、存储、通用小工具
   所有模块挂在 window.AB 上，谁都能读，别在这里写业务逻辑
   ========================================================================== */
window.AB = window.AB || {};

(function (AB) {
  'use strict';

  AB.NS = 'anima';                                        // 存储命名空间（打包版会换成 anima_pack）
  AB.DEFAULT_PROXY = 'http://127.0.0.1:8899';
  AB.DEFAULT_COMFY = 'http://127.0.0.1:8188';

  /* ---------------- DOM 小工具 ---------------- */
  AB.$ = function (s) { return document.querySelector(s); };
  AB.$all = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  AB.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  AB.copy = function (t) {
    try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
  };

  /* 轻提示 */
  AB.toast = function (t) {
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = t;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 1800);
  };

  /* 往对话区插一行灰提示 */
  AB.note = function (t) {
    var d = document.createElement('div');
    d.className = 'tip';
    d.textContent = '· ' + t;
    var chat = AB.$('#chat');
    if (!chat) return;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  };

  /* ---------------- 存储 ---------------- */
  AB.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    }
  };

  /* ---------------- 界面外观 ---------------- */
  /* 服务端 providers.json 里的 ui 段是准的（启动器往那写）。
     ui = { bg_opacity: 0-60, bg_image: 'assets/xxx.jpg', bg_exists: bool } */
  AB.applyUi = function (ui) {
    if (!ui) return;
    var root = document.documentElement;
    if (ui.bg_image && ui.bg_exists) {
      /* 坑：url() 写在自定义属性里时，是按「引用它的那份样式表」解析的 ——
         base.css 在 /assets/ 下，塞相对路径会变成 /assets/assets/xxx 直接 404，
         背景就成了纯色。所以这里一律补成站内绝对路径。 */
      var src = String(ui.bg_image);
      if (src.charAt(0) !== '/' && !/^(https?:)?\/\//i.test(src)) src = '/' + src;
      root.style.setProperty('--bg-url', 'url("' + src + '")');
    } else {
      root.style.removeProperty('--bg-url');            /* 回落到 CSS 里的默认图 */
    }
    if (typeof ui.bg_opacity === 'number' && !isNaN(ui.bg_opacity)) {
      var n = Math.max(0, Math.min(60, ui.bg_opacity));
      AB.state.cfg.bgImg = n;
      root.style.setProperty('--bg-img', String(n / 100));
    }
  };

  /* ---------------- 全局状态 ---------------- */
  var DEFAULTS = {
    mode: 'proxy', proxy: AB.DEFAULT_PROXY, limit: 5, extra: '',
    preset: 'standard',                 /* anima 模式记一份 */
    presetK2: 'standard',               /* krea2 模式单独记，两边互不覆盖 */
    engineK2: 'krea2',                  /* krea2 模式下出图走哪套工作流：krea2 | qwen */
    providerId: '', model: '',
    libs: [], libMode: 'nsfw', comfy: AB.DEFAULT_COMFY, theme: '', view: 'reverse',
    bgImg: 16                       // 背景图不透明度（百分比）
  };

  AB.state = {
    cfg: Object.assign({}, DEFAULTS, AB.store.get(AB.NS + '_cfg', {}) || {}),
    providers: AB.store.get(AB.NS + '_providers', []) || [],
    online: false,
    msgs: [],                       // 对话上下文
    imgs: new Map(),                // 图片池：id -> {dataUrl, active, round, el}
    round: 0,                       // 带图的轮次计数
    pending: null,                  // 待发送的图片 id
    busy: false
  };

  AB.limit = function () {
    return Math.max(1, parseInt(AB.state.cfg.limit, 10) || 5);
  };

  AB.persist = function () {
    AB.store.set(AB.NS + '_cfg', AB.state.cfg);
    AB.store.set(AB.NS + '_providers', AB.state.providers);
  };
})(window.AB);
