/* ==========================================================================
   chat.js — 对话区的消息渲染、加 tag、出图
   消息结构：{ role, text, img? }，assistant 的气泡存 dataset.mi 指回 msgs 下标
   ========================================================================== */
(function (AB) {
  'use strict';

  function scroll() {
    var c = AB.$('#chat');
    if (c) c.scrollTop = c.scrollHeight;
  }

  /* ---------------- 用户消息 ---------------- */
  function user(text, imgId) {
    var e = AB.$('#chatEmpty');
    if (e) e.remove();
    var w = document.createElement('div');
    w.className = 'msg u';
    var im = imgId ? AB.state.imgs.get(imgId) : null;
    w.innerHTML = '<div class="bub">' + AB.esc(text) + '</div>' +
      (im && im.dataUrl ? '<img src="' + im.dataUrl + '">' : '');
    AB.$('#chat').appendChild(w);
    scroll();
  }

  /* ---------------- 助手消息 ---------------- */
  function assistant(text, imgId) {
    var w = document.createElement('div');
    w.className = 'msg a';
    w.innerHTML = '<pre class="cursor"></pre><div class="acts">' +
      '<button class="cp">复制</button><button class="cpn">复制裸串</button>' +
      '<button class="gen">生成图片</button><button class="addtag">加 tag</button>' +
      '<button class="rg">重跑这张</button></div>';

    var pre = w.querySelector('pre');
    pre.textContent = text;

    w.querySelector('.cp').onclick = function () {
      AB.copy(pre.textContent);
      w.querySelector('.cp').textContent = '已复制';
    };
    w.querySelector('.cpn').onclick = function () {
      AB.copy(pre.textContent);
      w.querySelector('.cpn').textContent = '已复制';
    };
    w.querySelector('.gen').onclick = function () { pickEngine(w); };
    var at = w.querySelector('.addtag');
    if (AB.prompt && AB.prompt.mode && AB.prompt.mode() === 'krea2') {
      at.remove();                      /* krea2 是一整段散文，往里插 tag 没意义 */
    } else {
      at.onclick = function () { openTagRow(w); };
    }

    /* 重跑：照着这一轮的要求和图片再来一次，不动待发送区 */
    var rg = w.querySelector('.rg');
    rg.textContent = '重跑这次';
    rg.onclick = function () {
      var mi = w.dataset.mi;                       // 注意：这函数里气泡叫 w，不是 bubble
      if (mi == null || !AB.app || !AB.app.replay) { AB.toast('这条还没跑完，重不了'); return; }
      AB.app.replay(+mi);
    };

    AB.$('#chat').appendChild(w);
    scroll();
    return w;
  }

  /* ---------------- 加 tag ---------------- */
  function openTagRow(bubble) {
    var open = bubble.querySelector('.tagrow');
    if (open) { open.remove(); return; }

    var row = document.createElement('div');
    row.className = 'tagrow';
    row.innerHTML = '<input type="text" placeholder="要追加的 tag，可多个，用 ; 分隔 —— 例：hatsune miku (vocaloid); vocaloid">' +
                    '<button class="ghost ok">追加</button><button class="ghost no">取消</button>';
    bubble.appendChild(row);

    var inp = row.querySelector('input');
    inp.focus();

    function commit() {
      var v = inp.value.trim();
      if (!v) { row.remove(); return; }
      var pre = bubble.querySelector('pre');
      var next = AB.prompt.addTags(pre.textContent, v);
      pre.textContent = next;
      var mi = bubble.dataset.mi;
      if (mi != null && AB.state.msgs[+mi]) AB.state.msgs[+mi].text = next;  // 下一轮上下文跟着变
      AB.toast('已追加：' + v.slice(0, 34));
      row.remove();
    }

    inp.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { row.remove(); }
    };
    row.querySelector('.ok').onclick = commit;
    row.querySelector('.no').onclick = function () { row.remove(); };
  }

  /* ---------------- 出图 ---------------- */
  var ENGINES = { anima: 'Anima', krea2: 'Krea2', qwen: 'Qwen2.1' };

  function isK2() { return !!(AB.prompt.mode && AB.prompt.mode() === 'krea2'); }

  /* 点「生成图片」这一下先把引擎问清楚：krea2 模式下同一段提示词能喂两套工作流，
     anima 模式没得选，直接跑 */
  function pickEngine(bubble) {
    var btn = bubble.querySelector('.gen');
    if (!btn || btn.classList.contains('busy')) return;
    if (!(bubble.querySelector('pre').textContent || '').trim()) { AB.toast('还没有提示词'); return; }
    if (!isK2()) { genImage(bubble, 'anima'); return; }

    var open = bubble.querySelector('.engrow');
    if (open) { open.remove(); return; }

    var last = (AB.state.cfg.engineK2 === 'qwen') ? 'qwen' : 'krea2';
    var row = document.createElement('div');
    row.className = 'tagrow engrow';
    row.innerHTML =
      '<span class="lbl">用哪套出图</span>' +
      '<button class="ghost pick' + (last === 'krea2' ? ' last' : '') + '" data-e="krea2">Krea2 文生图</button>' +
      '<button class="ghost pick' + (last === 'qwen' ? ' last' : '') + '" data-e="qwen">Qwen2.1 文生图</button>' +
      '<button class="ghost no">取消</button>';
    bubble.appendChild(row);

    [].forEach.call(row.querySelectorAll('.pick'), function (b) {
      b.onclick = function () {
        var e = b.dataset.e;
        AB.state.cfg.engineK2 = e;          /* 记住这次选的，下次照它标出来 */
        AB.persist();
        row.remove();
        genImage(bubble, e);
      };
    });
    row.querySelector('.no').onclick = function () { row.remove(); };
  }

  async function genImage(bubble, engine) {
    var btn = bubble.querySelector('.gen');
    if (!btn || btn.classList.contains('busy')) return;

    var prompt = (bubble.querySelector('pre').textContent || '').trim();
    if (!prompt) { AB.toast('还没有提示词'); return; }
    engine = ENGINES[engine] ? engine : (isK2() ? 'krea2' : 'anima');
    if (AB.state.cfg.mode !== 'proxy') { AB.toast('出图要走本地代理，先在设置切回代理模式'); return; }

    btn.classList.add('busy');
    btn.textContent = '生成中…';
    AB.toast('已发给 ComfyUI（' + ENGINES[engine] + '），出图要等一会儿');

    /* 生成期间旁边挂一个中断键，出完/出错就摘掉 */
    var stop = document.createElement('button');
    stop.className = 'stop';
    stop.textContent = '中断';
    stop.onclick = async function () {
      stop.disabled = true;
      stop.textContent = '中断中…';
      try { await AB.net.comfyInterrupt(); } catch (e) {}
    };
    btn.parentNode.insertBefore(stop, btn.nextSibling);

    try {
      var j = await AB.net.comfyGenerate(prompt, engine);
      var box = document.createElement('div');
      box.className = 'genout';
      box.innerHTML = '<img src="' + j.url + '?' + Date.now() + '">' +
        '<div class="meta">' + AB.esc(j.engine_label || '出图') + ' · ' + AB.esc(j.file || '') +
        ' · <a href="' + j.url + '" target="_blank">原图</a></div>';
      bubble.appendChild(box);

      /* 图有高度之后滚才算真的到底：先滚一次占位，加载完再滚一次 */
      var im = box.querySelector('img');
      if (im) im.onload = function () { scroll(); };
      scroll();
      setTimeout(scroll, 150);

      btn.textContent = '再生成一张';
    } catch (err) {
      var m = String(err.message || err);
      AB.toast(m.indexOf('已中断') >= 0 ? '已中断这张'
        : (m.indexOf('连不上 ComfyUI') >= 0 ? '请先打开 ComfyUI' : ('生成失败：' + m.slice(0, 70))));
      btn.textContent = '生成图片';
    } finally {
      btn.classList.remove('busy');
      if (stop.parentNode) stop.remove();
    }
  }

  AB.chat = {
    user: user,
    assistant: assistant,
    openTagRow: openTagRow,
    pickEngine: pickEngine,
    genImage: genImage
  };
})(window.AB);
