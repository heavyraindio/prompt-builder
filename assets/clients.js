/* ==========================================================================
   clients.js — 模型商连接：顶栏选择器 + 设置里的增删改
   一条连接 = { id, name, api_base, key, models[] }
   ========================================================================== */
(function (AB) {
  'use strict';

  var fAll = [];          // 表单里拉到的全部模型
  var fSel = new Set();   // 表单里勾中的模型
  var fIdx = -1;          // 正在编辑的连接下标，-1 = 新建

  function status(t) {
    var el = AB.$('#stat');
    if (el) el.textContent = t;
  }

  /* 当前选中的连接 */
  function current() {
    var s = AB.state;
    return s.providers.filter(function (p) { return p.id === s.cfg.providerId; })[0]
        || s.providers[0] || null;
  }

  /* ---------------- 顶栏 ---------------- */
  function renderModels() {
    var p = current();
    var ms = (p && p.models) ? p.models : [];
    var sel = AB.$('#modelSel');
    if (!sel) return;
    sel.innerHTML = ms.length
      ? ms.map(function (m) { return '<option value="' + AB.esc(m) + '">' + AB.esc(m) + '</option>'; }).join('')
      : '<option value="">（未选模型）</option>';
    if (ms.indexOf(AB.state.cfg.model) < 0) AB.state.cfg.model = ms[0] || '';
    sel.value = AB.state.cfg.model || '';
    var note = AB.$('#pvnote');
    if (note) {
      note.textContent = !p ? '先去设置里添加连接' : (!ms.length ? '该连接还没勾选模型' : '');
    }
  }

  function renderTop() {
    var sel = AB.$('#provSel');
    if (!sel) return;
    var s = AB.state;
    sel.innerHTML = s.providers.length
      ? s.providers.map(function (p) { return '<option value="' + AB.esc(p.id) + '">' + AB.esc(p.name || p.id) + '</option>'; }).join('')
      : '<option value="">未连接</option>';
    if (!s.providers.some(function (p) { return p.id === s.cfg.providerId; })) {
      s.cfg.providerId = s.providers.length ? s.providers[0].id : '';
    }
    sel.value = s.cfg.providerId || '';

    var tag = AB.$('#modeTag');
    if (tag) {
      tag.textContent = (s.cfg.mode === 'proxy' ? '代理 · ' : '直连 · ') +
        (s.online ? '服务端在线' : '服务端离线');
    }
    var dot = AB.$('#dot');
    if (dot) dot.className = 'dot' + (s.online ? ' on' : '');
    renderModels();
  }

  /* ---------------- 设置里的连接列表 ---------------- */
  function renderList() {
    var box = AB.$('#connList');
    if (!box) return;
    if (!AB.state.providers.length) {
      box.innerHTML = '<div class="hint" style="margin-bottom:10px">还没有连接。填接口地址和 Key，拉取模型，勾选要用的几个，保存。</div>';
      return;
    }
    box.innerHTML = AB.state.providers.map(function (p, i) {
      return '<div class="conn"><div class="cinfo"><b>' + AB.esc(p.name || p.id) + '</b>' +
        '<span>' + AB.esc(p.api_base) + '</span>' +
        '<em>已选 ' + ((p.models || []).length) + ' 个模型</em></div>' +
        '<div class="cbtns"><button class="ghost edit" data-i="' + i + '">编辑</button>' +
        '<button class="ghost del" data-i="' + i + '">删除</button></div></div>';
    }).join('');
    AB.$all('#connList .edit').forEach(function (b) {
      b.onclick = function () { openForm(+b.dataset.i); };
    });
    AB.$all('#connList .del').forEach(function (b) {
      b.onclick = function () {
        AB.state.providers.splice(+b.dataset.i, 1);
        AB.persist();
        renderTop(); renderList();
      };
    });
  }

  /* ---------------- 表单 ---------------- */
  function openForm(i) {
    fIdx = (typeof i === 'number') ? i : -1;
    var p = fIdx >= 0 ? AB.state.providers[fIdx] : { name: '', api_base: '', key: '', models: [] };
    AB.$('#fName').value = p.name || '';
    AB.$('#fBase').value = p.api_base || '';
    AB.$('#fKey').value = p.key || '';
    AB.$('#fSearch').value = '';
    fAll = (p.models || []).slice();
    fSel = new Set(p.models || []);
    AB.$('#fSearchRow').hidden = !fAll.length;
    renderFModels();
    AB.$('#connForm').hidden = false;
    AB.$('#fBase').focus();
  }

  function renderFModels() {
    var q = (AB.$('#fSearch').value || '').toLowerCase();
    var list = q ? fAll.filter(function (m) { return m.toLowerCase().indexOf(q) >= 0; }) : fAll;
    var box = AB.$('#fModels');
    box.innerHTML = fAll.length
      ? (list.map(function (m) {
          return '<label class="mck"><input type="checkbox" data-m="' + AB.esc(m) + '"' +
            (fSel.has(m) ? ' checked' : '') + '><span>' + AB.esc(m) + '</span></label>';
        }).join('') || '<div class="hint" style="margin:8px">没有匹配的模型</div>')
      : '<div class="hint" style="margin:8px">还没拉取。填好地址和 Key，点「拉取模型」。</div>';

    AB.$all('#fModels input').forEach(function (c) {
      c.onchange = function () {
        if (c.checked) fSel.add(c.dataset.m); else fSel.delete(c.dataset.m);
        updateFSel();
      };
    });
    updateFSel();
  }

  function updateFSel() {
    var el = AB.$('#fSelNote');
    if (el) el.textContent = '已选 ' + fSel.size + ' 个 ／ 共 ' + fAll.length + ' 个';
  }

  async function doFetch() {
    var base = AB.$('#fBase').value.trim();
    var key = AB.$('#fKey').value.trim();
    if (!base) { status('先填接口地址'); return; }
    status('拉取中…');
    var models;
    try {
      models = await AB.net.fetchModels(base, key);
    } catch (e) {
      status('拉取失败：' + String(e.message || e).slice(0, 110));
      return;
    }
    if (!models.length) { status('拉到了，但列表是空的'); return; }
    fAll = Array.from(new Set(models)).sort();
    AB.$('#fSearchRow').hidden = false;
    renderFModels();
    status('拿到 ' + fAll.length + ' 个模型，勾选要用的');
  }

  function autoName(base) {
    try { return new URL(base).host; } catch (e) { return base.slice(0, 24) || '未命名连接'; }
  }

  function saveConn() {
    var base = AB.$('#fBase').value.trim().replace(/\/+$/, '');
    if (!base) { status('先填接口地址'); return; }
    if (!fAll.length) { status('先点「拉取模型」再保存'); return; }
    if (!fSel.size) { status('至少勾一个模型'); return; }

    var rec = {
      id: fIdx >= 0 ? AB.state.providers[fIdx].id : ('c' + Date.now().toString(36)),
      name: AB.$('#fName').value.trim() || autoName(base),
      api_base: base,
      key: AB.$('#fKey').value.trim(),
      models: Array.from(fSel)
    };
    if (fIdx >= 0) AB.state.providers[fIdx] = rec;
    else AB.state.providers.push(rec);

    AB.state.cfg.providerId = rec.id;
    AB.state.cfg.model = rec.models[0] || '';
    AB.persist();
    renderTop();
    renderList();
    AB.$('#connForm').hidden = true;
    status('已保存「' + rec.name + '」，可用模型 ' + rec.models.length + ' 个');
    AB.net.pushToServer();
  }

  AB.clients = {
    current: current,
    renderTop: renderTop,
    renderList: renderList,
    openForm: openForm,
    renderFModels: renderFModels,
    doFetch: doFetch,
    saveConn: saveConn,
    status: status
  };
})(window.AB);
