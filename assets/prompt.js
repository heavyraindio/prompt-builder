/* ==========================================================================
   prompt.js — 提示词层
   组装 system（base + 预设 + 词库 + 协议）、清洗模型输出、追加 tag
   规则文本都在 data/ 下，这里只管逻辑
   ========================================================================== */
(function (AB) {
  'use strict';
  var P = window.PRESET_PACK;            /* anima 那套：tag 为主 + 结尾一句自然语言 */
  var K = window.PRESET_PACK_KREA2;      /* krea2 那套：元信息 tag 行 + 一整段散文 */

  /* 走哪套：reverse.html?mode=krea2 切到 Krea2，默认 anima */
  AB.mode = (new URLSearchParams(location.search).get('mode') === 'krea2') ? 'krea2' : 'anima';
  function pack() { return (AB.mode === 'krea2' && K) ? K : P; }

  /* ---------------- 词库挂载 ---------------- */
/* 模式 → 要挂的条目 id：sfw 只要 tier=sfw 的；nsfw 全挂；custom 用用户勾的 */
P.libIds = function (mode, custom) {
  var libs = P.library || [];
  if (mode === 'custom') {
    var pick = custom || [];
    return libs.filter(function (l) { return pick.indexOf(l.id) >= 0; })
               .map(function (l) { return l.id; });
  }
  if (mode === 'nsfw') return libs.map(function (l) { return l.id; });
  return libs.filter(function (l) { return l.tier === 'sfw'; })
             .map(function (l) { return l.id; });
};
P.libChars = function (ids) {
  var libs = P.library || [];
  return libs.filter(function (l) { return ids.indexOf(l.id) >= 0; })
             .reduce(function (s, l) { return s + l.text.length; }, 0);
};

  /* ---------------- system 组装 ---------------- */
/* 组装 system：base + 预设增量 + 挂载的词库 + 输出协议 + 用户追加
   两个包结构一样，共用这一份逻辑 */
function buildFrom(PAK, presetId, extra, libIds) {
  var P = PAK;
  var p = (P.presets || []).filter(function (x) { return x.id === presetId; })[0] || P.presets[0];

  /* base 是所有预设共用的底子。个别预设要和它唱反调（比如海报模式要保留文字），
     就在自己的 patch 里定点替换掉，base 本体一个字不动，别的预设完全不受影响。 */
  var baseText = P.base;
  (p.patch || []).forEach(function (x) {
    baseText = baseText.replace(x.from, x.to);
  });

  var s = baseText + "\n\n" + p.rules + "\n\n" + P.protocol;

  var libs = P.library || [];
  var picked = (libIds && libIds.length)
    ? libs.filter(function (l) { return libIds.indexOf(l.id) >= 0; })
    : [];
  if (picked.length) {
    s += "\n\n【参考词库·取词时优先从这里挑标准写法，不许照抄与图无关的条目】\n" +
         picked.map(function (l) { return l.text; }).join("\n\n");
  }
  if (extra && extra.trim()) s += "\n\n【用户追加规则】\n" + extra.trim();
  return s;
}
P.build = function (a, b, c) { return buildFrom(P, a, b, c); };
if (K) K.build = function (a, b, c) { return buildFrom(K, a, b, c); };

  /* ---------------- 输出清洗 ---------------- */
  /* 模板已内置质量词与光影，模型偶尔仍会硬塞，这里按 tag 剔除 */
const BAN = new Set([
  'masterpiece','best quality','high quality','ultra detailed','highly detailed','very detailed',
  'absurdres','highres','8k','4k','uhd','score_9','score_8','score_7','amazing quality','very aesthetic',
  'anime style','anime art','anime screencap','illustration','official art','cel shading','flat color',
  'photo','photorealistic','realistic','realistic photo','hyperrealistic',
  'sunlight','moonlight','backlighting','rim light','warm lighting','cool lighting','soft lighting',
  'cinematic lighting','dramatic lighting','beautiful lighting','volumetric lighting','neon light','neon lights',
  'streetlights','god rays','light rays','light particles','glowing','illuminated','backlit','spotlight','flash',
  'warm tone','cool tone','sepia','blue tone','amber tone','depth of field','bokeh','lens flare','bloom',
  'detailed background','intricate details','finely detailed'
]);
function stripBanned(s){
  if(!s) return s;
  return s.split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .filter(p => !BAN.has(p.toLowerCase().replace(/[()[\]]/g, '').replace(/\s+/g, ' ').trim()))
    .join(', ');
}
function naked(t){
  let lines = (t || '').split('\n').map(x => x.trim()).filter(Boolean);
  lines = lines.map(l => l.replace(/^`{3}.*$/, '').trim()).filter(Boolean);
  lines = lines.filter(l => !/^(负面|negative|params?|参数|cfg|steps|说明|选词)/i.test(l));
  if(!lines.length) return '';
  lines.sort((a, b) => b.length - a.length);
  let s = lines[0].replace(/^(positive|正面|prompt|提示词)\s*[:：]\s*/i, '').trim();
  if(!/,/.test(s) && lines[1] && /,/.test(lines[1])) s = lines[1];
  s = s.replace(/\s+/g, ' ').trim();
  const cleaned = stripBanned(s);
  return cleaned || s;
}

  /* ---------------- 追加 tag ---------------- */
  /* 新 tag 插在末尾那句自然语言之前 —— Anima 对顺序敏感，tag 该在叙事句前面 */
function appendTags(text, raw){
  const add = raw.split(/[;；,，]/).map(s => s.trim()).filter(Boolean)
                 .filter((v, i, a) => a.indexOf(v) === i);
  if(!add.length) return text;
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  // 从尾巴往前扫：长段（>35 字符）或以句号收尾的，都算末尾叙事句的一部分，新 tag 要插在它们之前
  let cut = parts.length;
  for(let i = parts.length - 1; i >= 0; i--){
    const seg = parts[i];
    if(seg.split(/\s+/).length >= 5 || /[.!?]\s*$/.test(seg)) cut = i;
    else break;
  }
  const head = parts.slice(0, cut).filter(t => add.indexOf(t) < 0);
  const tail = parts.slice(cut);
  return head.concat(add).concat(tail).join(', ');
}

  /* krea2 的清洗跟 anima 反着来：anima 要压成一整条，krea2 要保住「tag 行 + 空行 + 散文」
     两段结构，千万不能按逗号拆或者只留最长那行 */
  function cleanKrea2(t) {
    var s = (t || '').trim();
    /* 顺序有讲究：先清围栏、再剥前缀、最后切负面——不然第一行是 ``` 时锚不到「正面：」 */
    s = s.replace(/```[a-z]*/gi, '').trim();
    s = s.replace(/^(正面|positive|prompt|提示词)\s*[:：]\s*/i, '');
    s = s.split(/\n\s*(?:负面|negative|反向提示词)\s*[:：]/i)[0].trim();

    var blocks = s.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!blocks.length) return '';
    if (blocks.length === 1) return blocks[0];
    /* 第一段是 tag 行，后面不管被模型切成几段，都并回同一段散文里 */
    var head = blocks[0];
    var body = blocks.slice(1).join(' ').replace(/\s+/g, ' ').trim();
    return head + '\n\n' + body;
  }

  AB.prompt = {
    mode: function () { return AB.mode; },
    /* 当前设置对应的完整 system */
    system: function () {
      var c = AB.state.cfg;
      /* 两套预设各记各的 id，来回切模式不会串味 */
      var pid = (AB.mode === 'krea2') ? (c.presetK2 || c.preset) : c.preset;
      /* krea2 不吃 danbooru tag 词库，那边一律不挂 */
      var ids = (AB.mode === 'krea2') ? [] : P.libIds(c.libMode, c.libs);
      return buildFrom(pack(), pid, c.extra, ids);
    },
    libIds:   function (mode, custom) { return P.libIds(mode, custom); },
    libChars: function (ids) { return P.libChars(ids); },
    library:  function () { return P.library || []; },
    presets:  function () { return (pack() || {}).presets || []; },
    clean:    function (t) { return (AB.mode === 'krea2') ? cleanKrea2(t) : naked(t); },
    stripBanned: stripBanned,
    addTags:  appendTags
  };
})(window.AB);
