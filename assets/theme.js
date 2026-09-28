/* ==========================================================================
   theme.js — 日夜主题
   门户和反推台共用；配色变量在 assets/base.css 里
   ========================================================================== */
(function (AB) {
  'use strict';

  function apply(name, save) {
    var t = (name === 'day') ? 'day' : 'night';
    document.documentElement.setAttribute('data-theme', t);
    AB.$all('#themeBtn button').forEach(function (b) {
      var on = (b.dataset.t === t);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    AB.state.cfg.theme = t;
    if (save !== false) AB.persist();
  }

  AB.theme = {
    apply: apply,
    /* ?theme=day / night 可强制指定；否则用记住的，再否则跟随系统 */
    init: function () {
      AB.$all('#themeBtn button').forEach(function (b) {
        b.onclick = function () { apply(b.dataset.t); };
      });
      var sysLight = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      var urlTheme = new URLSearchParams(location.search).get('theme');
      apply(urlTheme || AB.state.cfg.theme || (sysLight ? 'day' : 'night'), false);
    }
  };
})(window.AB);
