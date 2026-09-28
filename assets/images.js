/* ==========================================================================
   images.js — 投喂区：上传、超限压缩、轮次窗口、清空
   图片一律存内存（base64），超过窗口就从 dataUrl 上抹掉
   ========================================================================== */
(function (AB) {
  'use strict';

  var MAX_BYTES = 3 * 1024 * 1024;   // 超过就压
  var MAX_EDGE  = 2048;              // 压缩时长边上限

  function mb(b) { return (b / 1048576).toFixed(b < 1048576 ? 2 : 1) + 'MB'; }
  function dataBytes(d) {
    var i = d.indexOf(',') + 1;
    return Math.floor(Math.max(0, d.length - i) * 3 / 4);
  }

  function fileToDataURL(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function (e) { res(e.target.result); };
      r.onerror = function () { rej(new Error('读文件失败')); };
      r.readAsDataURL(file);
    });
  }

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('解码失败，可能不是有效图片')); };
      img.src = url;
    });
  }

  function pickType() {
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      return c.toDataURL('image/webp').indexOf('image/webp') === 5 ? 'image/webp' : 'image/jpeg';
    } catch (e) { return 'image/jpeg'; }
  }

  /* 超限图片：等比缩放 + 降质，迭代到上限以内 */
  async function compress(file) {
    var img = await loadImage(file);
    var w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > MAX_EDGE) {
      var k = MAX_EDGE / Math.max(w, h);
      w = Math.round(w * k); h = Math.round(h * k);
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    var type = pickType();
    var q = 0.85, url = c.toDataURL(type, q), round = 0;
    while (dataBytes(url) > MAX_BYTES && round < 7) {
      round++;
      if (q > 0.5) {
        q = Math.max(0.5, q - 0.12);
      } else {
        w = Math.max(512, Math.round(w * 0.8));
        h = Math.max(512, Math.round(h * 0.8));
        c.width = w; c.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        q = 0.72;
      }
      url = c.toDataURL(type, q);
    }
    return { dataUrl: url, before: file.size, after: dataBytes(url), w: w, h: h };
  }

  /* ---------------- 收图 ---------------- */
  async function add(file) {
    if (!file || !/^image\//.test(file.type || '')) return;
    var dataUrl, info = '';
    try {
      if (file.size > MAX_BYTES) {
        AB.toast('压缩中… ' + mb(file.size));
        var r = await compress(file);
        dataUrl = r.dataUrl;
        info = mb(r.before) + ' → ' + mb(r.after) + '（' + r.w + '×' + r.h + '）';
      } else {
        dataUrl = await fileToDataURL(file);
      }
    } catch (e) {
      AB.toast('读图失败：' + e.message);
      return;
    }
    var id = 'i' + Date.now() + Math.random().toString(36).slice(2, 6);
    AB.state.imgs.set(id, { dataUrl: dataUrl, active: true, round: AB.state.round + 1 });
    AB.state.pending = id;
    renderPending();
    renderGrid();
    if (info) AB.note('图片已压缩：' + info);
  }

  /* ---------------- 渲染 ---------------- */
  function renderGrid() {
    var g = AB.$('#grid');
    if (!g) return;
    g.innerHTML = '';
    AB.state.imgs.forEach(function (im) {
      var d = document.createElement('div');
      d.className = 'thumb' + (im.active ? '' : ' gone');
      d.innerHTML = (im.active ? '<img src="' + im.dataUrl + '">' : '') +
        '<div class="ph">MEMORY<br>PURGED</div><div class="tag">#' + im.round + '</div>';
      d.title = im.active ? '第 ' + im.round + ' 轮图片' : '已超出窗口，图片数据已清除';
      im.el = d;
      g.appendChild(d);
    });
    var act = 0;
    AB.state.imgs.forEach(function (im) { if (im.active) act++; });
    AB.$('#imgCnt').textContent = act + ' 张';
    renderRounds();
  }

  function renderRounds() {
    var el = AB.$('#rounds');
    if (!el) return;
    el.innerHTML = '';
    var L = AB.limit();
    for (var i = 1; i <= L; i++) {
      var r = AB.state.round - L + i;
      var s = document.createElement('i');
      if (r <= 0) {
        s.className = '';
      } else {
        var live = false;
        AB.state.imgs.forEach(function (im) { if (im.round === r) live = true; });
        s.className = live ? 'on' : 'dead';
      }
      el.appendChild(s);
    }
    if (AB.$('#limNote')) AB.$('#limNote').textContent = L;
  }

  function renderPending() {
    var p = AB.$('#pending');
    if (!p) return;
    p.innerHTML = '';
    if (!AB.state.pending) return;
    var im = AB.state.imgs.get(AB.state.pending);
    if (!im) { AB.state.pending = null; return; }
    var c = document.createElement('div');
    c.className = 'pchip';
    c.innerHTML = '<img src="' + im.dataUrl + '"><b>#' + (AB.state.round + 1) + '</b>';
    c.title = '点击取消这张图';
    c.onclick = function () {
      AB.state.imgs.delete(AB.state.pending);
      AB.state.pending = null;
      renderPending(); renderGrid();
    };
    p.appendChild(c);
  }

  /* ---------------- 轮次窗口 ---------------- */
  function prune() {
    var n = 0, L = AB.limit();
    AB.state.imgs.forEach(function (im) {
      if (im.active && (AB.state.round - im.round) >= L) {
        im.active = false;
        im.dataUrl = '';
        if (im.el) {
          im.el.classList.add('gone');
          var t = im.el.querySelector('img');
          if (t) t.remove();
        }
        n++;
      }
    });
    if (n) {
      renderGrid();
      AB.note('第 ' + AB.state.round + ' 轮：超出窗口的 ' + n + ' 张图片已从内存抹除，之后只保留文字记忆。');
    }
  }

  /* 手动清空：数据置空，界面上的缩略图一并标记已清除 */
  function clearAll() {
    var n = 0;
    AB.state.imgs.forEach(function (im) {
      if (im.active) n++;
      im.active = false;
      im.dataUrl = '';
    });
    AB.state.pending = null;
    AB.$all('.msg.u img').forEach(function (img) {
      var d = document.createElement('div');
      d.className = 'purged';
      d.textContent = 'PURGED';
      img.replaceWith(d);
    });
    renderGrid();
    renderPending();
    AB.note(n ? ('已清空 ' + n + ' 张图片缓存，接下来只能靠文字记忆改词。') : '当前没有可清的图片缓存。');
  }

  AB.images = {
    add: add,
    renderGrid: renderGrid,
    renderRounds: renderRounds,
    renderPending: renderPending,
    prune: prune,
    clearAll: clearAll
  };
})(window.AB);
