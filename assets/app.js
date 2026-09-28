/* ==========================================================================
   app.js — 装配层：把各模块接起来，管事件和启动
   业务逻辑不写在这里，这里只负责「谁来调谁」
   ========================================================================== */
(function (AB) {
  'use strict';

  var $ = AB.$;

  /* ============================ 预设包下拉 ============================ */
  /* 两套预设 id 可能同名（都叫 standard），所以分开存，切模式不互相覆盖 */
  function presetKey() {
    return (AB.prompt.mode && AB.prompt.mode() === 'krea2') ? 'presetK2' : 'preset';
  }
  function renderPresets() {
    var sel = $('#presetSel');
    if (!sel) return;
    var key = presetKey();
    var list = AB.prompt.presets();
    sel.innerHTML = list.map(function (p) {
      return '<option value="' + p.id + '">' + AB.esc(p.name) + '</option>';
    }).join('');
    /* 换模式后 preset 可能还是另一套的 id，落回这套的第一个 */
    var ids = list.map(function (p) { return p.id; });
    if (ids.indexOf(AB.state.cfg[key]) < 0) AB.state.cfg[key] = ids[0] || '';
    sel.value = AB.state.cfg[key];
    updatePresetNote();
  }
  function updatePresetNote() {
    var p = AB.prompt.presets().filter(function (x) { return x.id === $('#presetSel').value; })[0];
    $('#presetSel').title = p ? p.desc : '';
  }

  /* ============================ 参考词库 ============================ */
  function curLibs() {
    var c = AB.state.cfg;
    return Array.isArray(c.libs) ? c.libs : (c.libs = []);
  }
  function renderLib() {
    var box = $('#libList');
    if (!box) return;
    var custom = AB.state.cfg.libMode === 'custom';
    var libs = AB.prompt.library();

    box.innerHTML = libs.length
      ? libs.map(function (l) {
          return '<label class="mck"><input type="checkbox" data-id="' + AB.esc(l.id) + '"' +
            (curLibs().indexOf(l.id) >= 0 ? ' checked' : '') + '>' +
            '<span>' + AB.esc(l.name) + '</span><em>' +
            (l.tier === 'nsfw' ? 'NSFW · ' : '') + l.text.length + ' 字</em></label>';
        }).join('')
      : '<div class="hint" style="margin:8px">没有词库</div>';

    AB.$all('#libList input').forEach(function (c) {
      c.disabled = !custom;
      c.style.opacity = custom ? '1' : '.45';
      c.onchange = function () {
        var id = c.dataset.id;
        var arr = curLibs().slice();
        if (c.checked) { if (arr.indexOf(id) < 0) arr.push(id); }
        else arr = arr.filter(function (x) { return x !== id; });
        AB.state.cfg.libs = arr;
        updateLibNote();
        updateLibTip();
        AB.persist();
      };
    });
    updateLibNote();
    updateLibTip();
  }
  function updateLibNote() {
    var el = $('#libNote');
    if (!el) return;
    el.textContent = (AB.state.cfg.libMode === 'custom')
      ? ('自定义：已勾 ' + curLibs().length + ' 章')
      : ('当前是 ' + (AB.state.cfg.libMode === 'sfw' ? 'SFW' : 'NSFW') + ' 模式，勾选需切到自定义');
  }
  function updateLibTip() {
    var el = $('#libTip');
    if (!el) return;
    var ids = AB.prompt.libIds(AB.state.cfg.libMode, curLibs());
    var chars = AB.prompt.libChars(ids);
    el.textContent = ids.length
      ? (ids.length + ' 章 · ' + (chars / 10000).toFixed(1) + '万字')
      : '不挂词库';
  }

  /* ============================ 背景图 ============================ */
  function applyBg(v) {
    var n = Math.max(0, Math.min(60, parseInt(v, 10)));
    if (isNaN(n)) n = 16;
    document.documentElement.style.setProperty('--bg-img', String(n / 100));
    var box = $('#cBgVal');
    if (box) box.textContent = n + '%';
    var slider = $('#cBg');
    if (slider && String(n) !== slider.value) slider.value = n;
    return n;
  }

  /* 背景图那块的小字：把当前用的是哪张图说清楚 */
  function noteBg(ui) {
    var el = $('#bgHint');
    if (!el) return;
    var name = (ui && ui.bg_image && ui.bg_exists) ? ui.bg_image : 'assets/bg.jpg（默认）';
    el.textContent = '0 = 纯底色，数值越大背景越显。当前图：' + name + '，换图在启动器里选。';
  }

  /* ============================ 模式外观 ============================ */
  /* anima 和 krea2 共用一个界面，这里处理两种模式下的差异：
     牌子名、danbooru 词库的去留、空态文案、输入框提示、标题 */
  var MODE_TXT = {
    anima: {
      et: '只出正向提示词',
      es: '丢图 + 一句话（可空），拿回一整段可直接复制的 prompt。<br>' +
          '想改？下一轮直接说「改成黑发」「去掉场景」，其他一个字都不会动。',
      ph: '补充要求（可空）：反推这张图 / 只留人物和服装 / 改成夜景…',
      title: 'Anima 反推 · 反推台'
    },
    krea2: {
      et: '只出 Krea2/Qwen 两段式',
      es: '第一行元信息 tag（画质 / 美学 / 画风 / 分级），空一行，接着一整段英文散文。<br>' +
          '画面内容不拆 tag。想改？下一轮直接说「只要人物」「光写足点」，设定一个字都不动。',
      ph: '补充要求（可空）：反推这张图 / 只要人物和光影 / 压缩到 60 词…',
      title: 'Krea2/Qwen 反推 · 反推台'
    }
  };

  function applyMode() {
    var k2 = (AB.prompt.mode && AB.prompt.mode() === 'krea2');
    var t = k2 ? MODE_TXT.krea2 : MODE_TXT.anima;

    /* 挂个类名，CSS 想按模式微调时有抓手 */
    document.body.classList.toggle('k2', k2);
    document.documentElement.setAttribute('data-mode', k2 ? 'krea2' : 'anima');

    var brand = $('#brandName');
    if (brand) brand.textContent = k2 ? 'KREA2' : 'ANIMA';

    /* danbooru tag 词库只对 anima 有意义：顶栏两个字段 + 设置里整块都收掉 */
    ['#libMode', '#libTip'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var box = el.closest ? el.closest('.field') : null;
      if (box) box.style.display = k2 ? 'none' : '';
    });
    var libSec = $('#libSec');
    if (libSec) libSec.hidden = k2;


    /* 空态文案和输入提示跟着换，别让人拿 anima 的说明看 krea2 的输出 */
    var et = $('#chatEmpty .et'), es = $('#chatEmpty .es'), tx = $('#txt');
    if (et) et.textContent = t.et;
    if (es) es.innerHTML = t.es;
    if (tx) tx.placeholder = t.ph;

    document.title = t.title;
  }

  /* ============================ 视图切换 ============================ */
  function showView(name) {
    var isDan = (name === 'dan');
    var rev = $('#viewReverse'), dan = $('#viewDan');
    if (!rev || !dan) return;
    rev.hidden = isDan;
    dan.hidden = !isDan;
    AB.$all('#viewTabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === (isDan ? 'dan' : 'reverse'));
    });
    AB.state.cfg.view = isDan ? 'dan' : 'reverse';
    AB.persist();
  }

  /* ============================ 组请求 ============================ */
  function buildMessages(userText, imgId) {
    var out = [{ role: 'system', content: AB.prompt.system() }];

    AB.state.msgs.slice(-14).forEach(function (m) {
      if (m.role === 'assistant') {
        out.push({ role: 'assistant', content: m.text });
        return;
      }
      var im = m.img ? AB.state.imgs.get(m.img) : null;
      var plain = m.text + (im && !im.active ? '（该轮图片已超出窗口清除，只能依据文字修改）' : '');
      if (im && im.active) {
        out.push({ role: 'user', content: [
          { type: 'text', text: plain },
          { type: 'image_url', image_url: { url: im.dataUrl } }
        ]});
      } else {
        out.push({ role: 'user', content: plain });
      }
    });

    var cur = imgId ? AB.state.imgs.get(imgId) : null;
    if (cur && cur.active) {
      out.push({ role: 'user', content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: cur.dataUrl } }
      ]});
    } else {
      out.push({ role: 'user', content: userText });
    }
    return out;
  }

  /* ============================ 发送 ============================ */
  /* run 只管跑一轮：userText 和 imgId 都得是定好的 */
  async function run(userText, imgId) {
    var S = AB.state;
    if (S.busy) return;

    var p = AB.clients.current();
    if (!p) { AB.toast('先去设置里添加连接'); return; }
    if (!S.cfg.model) { AB.toast('这个连接还没勾选模型'); return; }

    /* 图要是已经被清掉了，这轮退化成纯文字 */
    var im = imgId ? S.imgs.get(imgId) : null;
    if (!(im && im.active)) imgId = null;

    if (imgId) {
      S.round++;
      im.round = S.round;
    }
    S.pending = null;
    AB.images.renderPending();

    AB.chat.user(userText, imgId);
    S.msgs.push({ role: 'user', text: userText, img: imgId || null });
    AB.images.renderGrid();
    AB.images.prune();

    S.busy = true;
    $('#send').disabled = true;
    $('#send').textContent = '咕咕…';

    var bubble = AB.chat.assistant('', imgId);
    var pre = bubble.querySelector('pre');
    pre.textContent = '…';

    try {
      var final = await AB.net.chat({
        model: S.cfg.model,
        messages: buildMessages(userText, imgId),
        stream: true,
        temperature: 0.6
      }, function (partial, meta) {
        if (partial) {
          pre.textContent = partial;
        } else if (meta && meta.thinking) {
          /* 推理模型先想半天，给个进度别让人以为卡死 */
          pre.textContent = '…（模型在思考，已想 ' + meta.thinking + ' 字）';
        }
        $('#chat').scrollTop = $('#chat').scrollHeight;
      });

      var cleaned = AB.prompt.clean(final) || (final || '').trim();
      pre.textContent = cleaned || '(这个模型什么都没返回 —— 换个模型，或检查连接模式)';
      if (!cleaned) pre.style.color = 'var(--bad)';

      /* ask / img 记下来，「重跑这次」要用 */
      S.msgs.push({ role: 'assistant', text: cleaned, ask: userText, img: imgId || null });
      bubble.dataset.mi = String(S.msgs.length - 1);
    } catch (err) {
      pre.remove();
      bubble.insertAdjacentHTML('afterbegin',
        '<div class="err">连不上／出错：' + AB.esc(err.message) +
        '<br>' + (S.cfg.mode === 'direct'
          ? '直连被跨域拦了的话，改成代理模式：先双击 start.bat 再刷新本页。'
          : '确认 start.bat 开着，且设置里的代理地址是 http://127.0.0.1:8899') + '</div>');
      S.msgs.pop();
    } finally {
      S.busy = false;
      $('#send').disabled = false;
      $('#send').textContent = '反推 ↵';
    }
  }

  /* 点发送：料从输入框和待发送区取 */
  function send() {
    var text = $('#txt').value.trim();
    var pendingId = AB.state.pending;
    if (!text && !pendingId) { AB.toast('先丢一张图，或写句话'); return; }
    var ut = text || (pendingId ? '反推这张图，只输出正向提示词' : '沿用上一版，按我的要求修改');
    $('#txt').value = '';
    autoSize();
    run(ut, pendingId);
  }

  /* 重跑某条结果对应的那一轮：要求原样、图片原样，直接再来一次 */
  function replay(mi) {
    var m = AB.state.msgs[mi];
    if (!m || !m.ask) { AB.toast('这条还没跑完，重不了'); return; }
    if (AB.state.busy) { AB.toast('正在跑，等这轮完'); return; }
    var im = m.img ? AB.state.imgs.get(m.img) : null;
    var alive = !!(im && im.active);
    if (m.img && !alive) AB.toast('原图已被清掉，这轮只按文字重跑');
    run(m.ask, alive ? m.img : null);
  }

  /* ============================ 设置抽屉 ============================ */
  function openDrawer() {
    var c = AB.state.cfg;
    $('#cMode').value = c.mode;
    $('#cProxy').value = c.proxy;
    $('#cComfy').value = c.comfy || AB.DEFAULT_COMFY;
    $('#cLimit').value = String(AB.limit());
    applyBg(c.bgImg);
    if (AB.net.uiConf) {
      AB.net.uiConf().then(function (ui) {
        if (!ui) return;
        AB.applyUi(ui);
        applyBg(AB.state.cfg.bgImg);
        noteBg(ui);
      });
    }
    $('#cExtra').value = c.extra;
    $('#connForm').hidden = true;
    $('#libMode').value = c.libMode || 'nsfw';

    /* D 站配置：代理、账号、key */
    if (AB.net.danConf) {
      AB.net.danConf().then(function (d) {
        $('#cDanProxy').value = d.proxy || '';
        $('#cDanLogin').value = d.login || '';
        $('#cDanKey').value = '';
        $('#cDanKey').placeholder = d.has_key ? '已保存（留空则不改）' : 'API Key';
        var n = $('#danCfgNote');
        if (n) {
          n.textContent = d.authed ? '已登录，一次可搜多个 tag'
            : (d.proxy ? '没填账号：一次最多搜 2 个 tag（翻页上限 1000 页，匿名也一样）'
                       : '还没挂代理，图库连不上');
        }
      });
    }
    AB.clients.renderList();
    renderLib();
    $('#drawer').classList.add('on');
  }

  async function saveSettings() {
    var c = AB.state.cfg;
    c.mode = $('#cMode').value;
    c.proxy = $('#cProxy').value.trim() || AB.DEFAULT_PROXY;
    c.comfy = ($('#cComfy').value.trim() || AB.DEFAULT_COMFY).replace(/\/+$/, '');
    c.limit = Math.max(1, parseInt($('#cLimit').value, 10) || 5);
    c.bgImg = applyBg($('#cBg').value);
    c.extra = $('#cExtra').value;
    AB.persist();

    /* D 站配置走服务端文件 */
    if (AB.net.danConfSave) {
      var dan = { proxy: $('#cDanProxy').value.trim(), login: $('#cDanLogin').value.trim() };
      var dk = $('#cDanKey').value.trim();
      if (dk) dan.api_key = dk;                    // 留空表示不改
      try { await AB.net.danConfSave(dan); } catch (e) {}
    }

    AB.images.renderRounds();
    AB.clients.renderTop();
    AB.clients.status('已保存');
    setTimeout(function () {
      $('#drawer').classList.remove('on');
      AB.clients.status('');
    }, 420);
  }

  /* ============================ 事件 ============================ */
  var txt;

  function autoSize() {
    txt.style.height = 'auto';
    txt.style.height = Math.min(txt.scrollHeight, 120) + 'px';
  }

  function bind() {
    txt = $('#txt');

    /* 顶栏：视图切换 */
    AB.$all('#viewTabs button').forEach(function (b) {
      b.onclick = function () { showView(b.dataset.view); };
    });

    $('#send').onclick = send;
    txt.addEventListener('input', autoSize);
    txt.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    $('#presetSel').onchange = function () {
      AB.state.cfg[presetKey()] = $('#presetSel').value;
      updatePresetNote();
      AB.persist();
    };
    $('#libMode').onchange = function () {
      AB.state.cfg.libMode = $('#libMode').value;
      renderLib();
      AB.persist();
    };
    $('#provSel').onchange = function () {
      AB.state.cfg.providerId = $('#provSel').value;
      AB.state.cfg.model = '';
      AB.clients.renderTop();
      AB.persist();
    };
    $('#modelSel').onchange = function () {
      AB.state.cfg.model = $('#modelSel').value;
      AB.persist();
    };

    /* 投喂区 */
    $('#drop').onclick = function () {
      var i = document.createElement('input');
      i.type = 'file';
      i.accept = 'image/*';
      i.multiple = true;
      i.onchange = function () { Array.prototype.forEach.call(i.files, AB.images.add); };
      i.click();
    };
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('#drop').addEventListener(ev, function (e) { e.preventDefault(); $('#drop').classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('#drop').addEventListener(ev, function (e) { e.preventDefault(); $('#drop').classList.remove('over'); });
    });
    $('#drop').addEventListener('drop', function (e) {
      Array.prototype.forEach.call(e.dataTransfer.files, AB.images.add);
    });
    document.addEventListener('paste', function (e) {
      Array.prototype.slice.call((e.clipboardData || {}).items || [])
        .filter(function (i) { return i.type.indexOf('image/') === 0; })
        .forEach(function (i) { AB.images.add(i.getAsFile()); });
    });
    $('#clearImg').onclick = AB.images.clearAll;

    /* 设置抽屉 */
    $('#cfgBtn').onclick = openDrawer;
    $('#drawer').onclick = function (e) { if (e.target.id === 'drawer') $('#drawer').classList.remove('on'); };
    $('#save').onclick = saveSettings;
    $('#syncTo').onclick = async function () {
      var ok = await AB.net.pushToServer();
      AB.clients.status(ok ? 'providers.json 已更新' : '写回失败（代理模式才支持）');
    };
    $('#wipe').onclick = function () {
      if (!confirm('清掉本机浏览器里保存的连接和设置？（不动 providers.json）')) return;
      try {
        localStorage.removeItem(AB.NS + '_cfg');
        localStorage.removeItem(AB.NS + '_providers');
      } catch (e) {}
      AB.state.providers = [];
      AB.state.cfg.providerId = '';
      AB.state.cfg.model = '';
      AB.state.msgs = [];
      AB.state.imgs.clear();
      AB.state.round = 0;
      AB.state.pending = null;
      AB.clients.renderTop();
      AB.clients.renderList();
      AB.images.renderGrid();
      AB.images.renderPending();
      AB.clients.status('本机数据已清空');
    };

    /* 连接表单 */
    $('#addConn').onclick = function () { AB.clients.openForm(); };
    $('#fCancel').onclick = function () { $('#connForm').hidden = true; };
    $('#fFetch').onclick = AB.clients.doFetch;
    $('#fSearch').oninput = AB.clients.renderFModels;
    $('#fSave').onclick = AB.clients.saveConn;

    /* 背景透明度：拖动就实时变，松手才存 */
    $('#cBg').oninput = function () { applyBg(this.value); };
    $('#cBg').onchange = function () {
      AB.state.cfg.bgImg = applyBg(this.value);
      AB.persist();
      if (AB.net.uiSave) AB.net.uiSave({ bg_opacity: AB.state.cfg.bgImg });   /* 写回服务端，启动器也跟着变 */
    };

    /* 词库 */
    $('#libNone').onclick = function () {
      AB.state.cfg.libs = [];
      renderLib();
      AB.persist();
    };
  }

  /* ============================ 启动 ============================ */
  async function boot() {
    AB.theme.init();
    applyBg(AB.state.cfg.bgImg);
    applyMode();
    renderPresets();
    renderLib();
    AB.clients.renderList();
    bind();
    AB.images.renderGrid();

    if (AB.dan) AB.dan.init();

    /* ?view=dan&q=hatsune_miku 可以直接落到图库并搜一把 */
    var url = new URLSearchParams(location.search);
    var wantDan = url.get('view') === 'dan' || AB.state.cfg.view === 'dan';
    showView(wantDan ? 'dan' : 'reverse');
    var urlQ = url.get('q');
    if (AB.dan) {
      if (urlQ) AB.dan.search(urlQ);
      /* dan.init() 里已经拉过一屏最新，这里不用重复 */
    }

    await AB.net.bootServer();
    AB.clients.renderTop();

    /* 外观以服务端那份为准：启动器里调的背景图与不透明度 */
    var ui = AB.net.uiConf ? await AB.net.uiConf() : null;
    if (ui) {
      AB.applyUi(ui);
      applyBg(AB.state.cfg.bgImg);
      noteBg(ui);
    }
  }

  AB.app = {
    send: send,
    run: run,
    replay: replay,
    boot: boot,
    showView: showView,
    renderPresets: renderPresets,
    renderLib: renderLib
  };
  document.addEventListener('DOMContentLoaded', boot);
})(window.AB);
