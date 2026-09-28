/* ==========================================================================
   dan.js — 图库：Browse Danbooru
   搜图 / 搜 tag / 看图 / 按分类取 tag，两个出口：
     「发送图片」→ 投喂区（走压缩逻辑）
     「发送 tag」→ 反推栏的补充要求输入框
   ========================================================================== */
(function (AB) {
  'use strict';

  var CATS = [
    { key: 'tag_string_artist',    name: 'Artist',    cls: 'artist'    },
    { key: 'tag_string_copyright', name: 'Copyright', cls: 'copyright' },
    { key: 'tag_string_character', name: 'Character', cls: 'character' },
    { key: 'tag_string_general',   name: 'General',   cls: 'general'   }
  ];

  var S = { mode: 'posts', kw: '', page: 1, posts: [], tags: [], sel: null,
          busy: false, loading: false, total: 0 };

  function el(id) { return AB.$('#' + id); }
  function stat(html) { var e = el('danStat'); if (e) e.innerHTML = html; }
  function msg(html) {
    el('danGrid').innerHTML = '<div class="danempty">' + html + '</div>';
  }

  /* ---------------- 搜索 ---------------- */
  async function run(page) {
    if (S.loading) return;
    S.loading = true;
    S.page = Math.max(1, page || 1);
    stat('查询中…');

    try {
      if (S.mode === 'tags') {
        var t = await AB.net.dan({
          api: 'tags', limit: 60,
          'search[name_matches]': '*' + S.kw.replace(/\s+/g, '_') + '*',
          'search[order]': 'count'
        });
        S.tags = Array.isArray(t) ? t : [];
        S.total = 0;
        renderTags();
        renderPager(0);
        stat(S.tags.length ? ('<b>' + S.tags.length + '</b> 个 tag') : '没找到 tag');
      } else {
        /* 帖子和总数一起要，总数给分页条用 */
        var got = await Promise.all([
          AB.net.dan({ api: 'posts', limit: PER, page: S.page, tags: S.kw }),
          AB.net.dan({ api: 'counts', tags: S.kw }).catch(function () { return { counts: { posts: 0 } }; })
        ]);
        S.posts = Array.isArray(got[0]) ? got[0] : [];
        S.total = (got[1] && got[1].counts && got[1].counts.posts) || 0;

        renderGrid();
        renderPager(S.total);
        var g = el('danGrid');
        if (g) g.scrollTop = 0;
        stat('已加载 <b>' + S.posts.length + '</b> 张' +
             (S.total ? ' · 命中 <b>' + S.total.toLocaleString() + '</b> 帖' : ''));
        if (!S.posts.length) msg('这个 tag 组合没搜到东西，换个词试试。');
      }
    } catch (e) {
      msg('连不上 D 站：' + AB.esc(String(e.message || e).slice(0, 160)) +
          '<br>去 <code>providers.json</code> 的 <code>danbooru.proxy</code> 填上代理地址。');
      renderPager(0);
      stat('出错');
    } finally {
      S.loading = false;
    }
  }

  /* ---------------- 结果：图片网格 ---------------- */
  function renderGrid() {
    var g = el('danGrid');
    g.innerHTML = S.posts.map(function (p, i) {
      var thumb = p.preview_file_url || p.large_file_url || '';
      return '<div class="danitem" data-i="' + i + '">' +
        (thumb ? '<img loading="lazy" src="' + AB.net.danImg(thumb) + '">' : '') +
        '<span class="rt">' + AB.esc(p.rating || '?') + '</span>' +
        '<span class="sc">' + (p.score || 0) + '</span></div>';
    }).join('');
    AB.$all('#danGrid .danitem').forEach(function (d) {
      d.onclick = function () { select(S.posts[+d.dataset.i], d); };
    });
  }

  /* ---------------- 分页条 ---------------- */
  var PER = 40;          // 每页条数
  var MAX_PAGES = 1000;  // D 站硬上限：page 超过 1000 直接 410（实测匿名也一样）
  var AUTHED = false;    // 有没有填账号，只影响一次能搜几个 tag

  function maxPages(total) {
    var byTotal = Math.ceil((total || 0) / PER) || 1;
    return Math.max(1, Math.min(byTotal, MAX_PAGES));
  }

  function renderPager(total) {
    var box = el('danPager');
    if (!box) return;
    if (S.mode !== 'posts' || !S.posts.length) { box.innerHTML = ''; return; }

    var pages = maxPages(total);
    var cur = S.page;
    var win = 4;                                  // 当前页前后各留 4 页

    var from = Math.max(1, cur - win);
    var to = Math.min(pages, cur + win);
    if (to - from < win * 2) {                    // 靠边时把窗口补满
      if (from === 1) to = Math.min(pages, from + win * 2);
      else from = Math.max(1, to - win * 2);
    }

    var html = '<button class="nav" data-p="' + (cur - 1) + '"' +
               (cur <= 1 ? ' disabled' : '') + '>‹</button>';

    if (from > 1) {
      html += '<button data-p="1">1</button>';
      if (from > 2) html += '<span class="gap">···</span>';
    }
    for (var i = from; i <= to; i++) {
      html += '<button data-p="' + i + '"' + (i === cur ? ' class="on"' : '') + '>' + i + '</button>';
    }
    if (to < pages) {
      if (to < pages - 1) html += '<span class="gap">···</span>';
      html += '<button data-p="' + pages + '">' + pages + '</button>';
    }

    html += '<button class="nav" data-p="' + (cur + 1) + '"' +
            (cur >= pages ? ' disabled' : '') + '>›</button>';

    if (total) {
      var capped = Math.ceil(total / PER) > MAX_PAGES;
      html += '<span class="sum">命中 <b>' + Number(total).toLocaleString() + '</b> 帖 · 第 <b>' +
              cur + '</b> / ' + pages + ' 页' +
              (capped ? ' · <span class="warn2">只能翻前 ' + MAX_PAGES + ' 页</span>' : '') + '</span>';
    }
    box.innerHTML = html;

    AB.$all('#danPager button[data-p]').forEach(function (b) {
      b.onclick = function () {
        var n = +b.dataset.p;
        if (!b.disabled && n >= 1 && n <= MAX_PAGES) run(n);
      };
    });
  }

  /* ---------------- 结果：tag 列表 ---------------- */
  function catLabel(c) {
    return { 1: 'Artist', 3: 'Copyright', 4: 'Character', 0: 'General' }[c] || 'General';
  }
  function catCls(c) {
    return { 1: 'artist', 3: 'copyright', 4: 'character', 0: 'general' }[c] || 'general';
  }

  function renderTags() {
    var g = el('danGrid');
    if (!S.tags.length) { msg('没找到 tag。'); return; }
    g.innerHTML = '<div class="danlist">' + S.tags.map(function (t) {
      return '<div class="dantag" data-t="' + AB.esc(t.name) + '">' +
        '<span class="cat ' + catCls(t.category) + '">' + catLabel(t.category) + '</span>' +
        '<span class="nm">' + AB.esc(t.name) + '</span>' +
        '<span class="ct">' + (t.post_count || 0).toLocaleString() + ' 帖</span></div>';
    }).join('') + '</div>';

    AB.$all('#danGrid .dantag').forEach(function (row) {
      var name = row.dataset.t;
      /* 点 tag 名：塞进搜索框继续搜图 */
      row.querySelector('.nm').onclick = function () {
        el('danKw').value = name;
        S.mode = 'posts';
        el('danMode').value = 'posts';
        S.kw = name;
        run(1);
      };
      /* 右侧小按钮：直接送到补充要求 */
      row.oncontextmenu = function (e) { e.preventDefault(); toPrompt(name); };
    });
    g.scrollTop = 0;
  }

  /* ---------------- 详情 ---------------- */
  function select(post, node) {
    if (!post) return;
    S.sel = post;
    AB.$all('#danGrid .danitem').forEach(function (d) { d.classList.remove('on'); });
    if (node) node.classList.add('on');
    renderDetail(post);
  }

  function renderDetail(p) {
    var big = p.large_file_url || p.file_url || p.preview_file_url || '';
    var tagsOf = function (key) {
      return (p[key] || '').split(/\s+/).filter(Boolean);
    };

    var html =
      (big ? '<img class="danimg" id="danBig" src="' + AB.net.danImg(big) + '">' : '') +
      '<div class="danacts">' +
        '<button class="primary" id="danSendImg">发送图片</button>' +
        '<button id="danSendAll">发送全部 tag</button>' +
      '</div>' +
      '<div class="danmeta">#' + p.id + ' · ' + AB.esc(p.rating || '?') +
        ' · 分数 ' + (p.score || 0) + ' · ' +
        '<a href="https://danbooru.donmai.us/posts/' + p.id + '" target="_blank">在原站打开</a></div>';

    CATS.forEach(function (c) {
      var arr = tagsOf(c.key);
      html += '<div class="blk"><div class="blkhead">' +
        '<span class="cat ' + c.cls + '">' + c.name + '</span>' +
        '<span class="n">' + arr.length + ' 个</span>' +
        (arr.length ? '<button data-cat="' + c.key + '">发送本类</button>' : '') +
        '</div><div class="tagwrap">' +
        arr.map(function (t) {
          return '<button class="tg' + (t.length > 26 ? ' long' : '') + '" data-t="' + AB.esc(t) + '">' +
            AB.esc(t) + '</button>';
        }).join('') +
        '</div></div>';
    });

    var side = el('danSide');
    side.innerHTML = html;

    /* 单个 tag：单击进搜索栏，双击进补充要求
       双击要区分，所以单击延后一点点再执行 */
    AB.$all('#danSide .tg').forEach(function (b) {
      b.onclick = function () {
        clearTimeout(b._clickTimer);
        b._clickTimer = setTimeout(function () { toSearch(b.dataset.t); }, 230);
      };
      b.ondblclick = function () {
        clearTimeout(b._clickTimer);
        toPrompt(b.dataset.t);
      };
    });
    /* 整类 → 补充要求 */
    AB.$all('#danSide .blkhead button').forEach(function (b) {
      b.onclick = function () {
        var arr = tagsOf(b.dataset.cat);
        if (arr.length) toPrompt(arr.join(', '));
      };
    });
    /* 全部 */
    el('danSendAll').onclick = function () {
      var all = [];
      CATS.forEach(function (c) { all = all.concat(tagsOf(c.key)); });
      if (all.length) toPrompt(all.join(', '));
    };
    /* 发送图片 → 投喂区 */
    el('danSendImg').onclick = function () { sendImage(p, big); };

    var bimg = el('danBig');
    if (bimg) bimg.onclick = function () { window.open(AB.net.danImg(big), '_blank'); };
  }

  function emptyGrid() {
    var g = el('danGrid');
    if (!g) return;
    g.innerHTML = '<div class="danempty">正在拉 D 站最新投稿…</div>';
  }

  function emptySide() {
    el('danSide').innerHTML =
      '<div class="ph">搜点什么，然后点一张图。<br><br>' +
      '选中后这里会把它的 tag 按 <b>Artist</b> / <b>Copyright</b> / <b>Character</b> / <b>General</b> 分开列出来。<br><br>' +
      '<b>单击</b> tag → 进上面的搜图栏，直接搜它<br>' +
      '<b>双击</b> tag → 进反推栏的补充要求<br>' +
      '「发送本类」「发送全部」→ 一样进补充要求<br>' +
      '「发送图片」→ 图直接进投喂区</div>';
  }

  /* ---------------- 两个出口 ---------------- */
  /* 单击 tag：塞进搜索栏并搜。已有就不重复加，多个 tag 自然组成组合搜索 */
  function toSearch(tag) {
    var box = el('danKw');
    if (!box) return;
    var parts = (box.value || '').trim().split(/\s+/).filter(Boolean);
    if (parts.indexOf(tag) < 0) parts.push(tag);
    box.value = parts.join(' ');
    S.kw = box.value;
    acClose();
    run(1);
  }

  function toPrompt(text) {
    var box = el('txt');
    if (!box) return;
    var cur = box.value.trim().replace(/[,\s]+$/, '');
    box.value = cur ? (cur + ', ' + text) : text;
    box.dispatchEvent(new Event('input'));
    box.scrollTop = box.scrollHeight;
    AB.toast('已送到补充要求');
  }

  async function sendImage(post, url) {
    var btn = el('danSendImg');
    if (btn) { btn.disabled = true; btn.textContent = '取图中…'; }
    try {
      var file = await AB.net.danFetchFile(url, 'dan_' + post.id + '.jpg');
      await AB.images.add(file);
      AB.toast('图片已进投喂区');
      AB.app.showView('reverse');
    } catch (e) {
      AB.toast('取图失败：' + String(e.message || e).slice(0, 50));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '发送图片'; }
    }
  }

  /* 滚到底自动续下一页 */
    /* ---------------- 搜索补全 ---------------- */
  var acTimer = null, acItems = [], acIdx = 0;

  function acBox() { return el('danAc'); }

  function curWord() {
    var parts = (el('danKw').value || '').split(/\s+/);
    return parts[parts.length - 1] || '';
  }
  function replaceWord(w) {
    var parts = (el('danKw').value || '').split(/\s+/);
    parts[parts.length - 1] = w;
    el('danKw').value = parts.join(' ') + ' ';
  }
  function highlight(name, kw) {
    var i = name.toLowerCase().indexOf(kw.toLowerCase());
    if (i < 0) return AB.esc(name);
    return AB.esc(name.slice(0, i)) + '<b>' + AB.esc(name.slice(i, i + kw.length)) + '</b>' +
           AB.esc(name.slice(i + kw.length));
  }

  function acClose() {
    var b = acBox();
    if (b) { b.hidden = true; b.innerHTML = ''; }
    acItems = []; acIdx = 0;
  }

  function acOpen(list, kw) {
    var b = acBox();
    if (!b || !list.length) { acClose(); return; }
    acItems = list.slice(0, 12);
    acIdx = 0;
    b.innerHTML = acItems.map(function (t, i) {
      return '<div class="acitem' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="cat ' + catCls(t.category) + '">' + catLabel(t.category) + '</span>' +
        '<span class="nm">' + highlight(t.name, kw) + '</span>' +
        '<span class="ct">' + (t.post_count || 0).toLocaleString() + '</span></div>';
    }).join('');
    b.hidden = false;
    AB.$all('#danAc .acitem').forEach(function (row) {
      row.onmousedown = function (e) {       // 用 mousedown，抢在输入框 blur 之前
        e.preventDefault();
        acPick(+row.dataset.i);
      };
    });
  }

  function acMove(d) {
    if (!acItems.length) return;
    acIdx = (acIdx + d + acItems.length) % acItems.length;
    AB.$all('#danAc .acitem').forEach(function (r, i) { r.classList.toggle('on', i === acIdx); });
    var cur = AB.$all('#danAc .acitem')[acIdx];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function acPick(i) {
    var t = acItems[i];
    if (!t) return;
    replaceWord(t.name);
    acClose();
    search();
  }

  function acQuery() {
    var w = curWord();
    if (w.length < 2) { acClose(); return; }
    AB.net.dan({ api: 'tags', limit: 12,
                 'search[name_matches]': '*' + w + '*', 'search[order]': 'count' })
      .then(function (r) { acOpen(Array.isArray(r) ? r : [], w); })
      .catch(function () { acClose(); });
  }

  /* 统一入口：给关键词就搜，不给就读输入框 */
  function search(kw) {
    S.kw = (kw != null ? kw : (el('danKw').value || '')).trim();
    if (el('danKw')) el('danKw').value = S.kw;
    run(1);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    emptyGrid();
    emptySide();
    /* 关键词留空 = 直接看 D 站最新投稿 */
    el('danGo').onclick = function () { search(); };
    el('danKw').oninput = function () {
      clearTimeout(acTimer);
      acTimer = setTimeout(acQuery, 220);      // 打两个字以上才开始补全
    };
    el('danKw').onkeydown = function (e) {
      var box = acBox();
      var open = box && !box.hidden && acItems.length;
      if (open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); acMove(-1); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acPick(acIdx); return; }
        if (e.key === 'Escape')    { acClose(); return; }
      }
      if (e.key === 'Enter') { e.preventDefault(); acClose(); search(); }
    };
    el('danKw').onblur = function () { setTimeout(acClose, 120); };
    document.addEventListener('mousedown', function (e) {
      if (!e.target.closest || !e.target.closest('.acwrap')) acClose();
    });
    el('danKw').onfocus = function () { if (curWord().length >= 2) acQuery(); };
    el('danMode').onchange = function () {
      S.mode = el('danMode').value;
      acClose();
      search();
    };

    /* 查一次是否填了 D 站账号，决定能翻多少页 */
    AB.net.danConf().then(function (c) {
      AUTHED = !!c.authed;
      if (AUTHED && S.posts.length) renderPager(S.total);
    });

    /* 打开图库就先给一屏最新的，不用等用户输入 */
    var hasQ = new URLSearchParams(location.search).get('q');
    if (!hasQ) run(1);
  }

  AB.dan = { init: init, run: run, search: search, toPrompt: toPrompt, emptyGrid: emptyGrid };
})(window.AB);
