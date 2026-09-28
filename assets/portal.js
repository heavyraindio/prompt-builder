/* ==========================================================================
   portal.js — 门户页
   只做主题 / 背景初始化和模式入口，具体功能在各页面里
   ========================================================================== */
(function (AB) {
  'use strict';

  /* 背景图透明度跟主程序共用一份设置 */
  var n = Math.max(0, Math.min(60, parseInt(AB.state.cfg.bgImg, 10)));
  if (isNaN(n)) n = 16;
  document.documentElement.style.setProperty('--bg-img', String(n / 100));

  AB.theme.init();

  /* 背景图与不透明度以服务端那份为准（启动器里调的） */
  if (AB.net && AB.net.uiConf) {
    AB.net.uiConf().then(function (ui) { AB.applyUi(ui); });
  }

  /* 顺手和服务端对一次连接清单：key 只留本机，文件里那份会被搬过来再擦掉。
     放这儿是为了「先开门户页」也照样触发搬迁，不用非得进反推页。 */
  if (AB.net && AB.net.bootServer) AB.net.bootServer();

  var tag = AB.$('#tagMode');
  if (tag) {
    tag.onclick = function () { AB.toast('打标模式还没构思好，先占个位'); };
  }
})(window.AB);
