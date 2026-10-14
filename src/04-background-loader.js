/* Development/source-mode loader for optional Background behavior JavaScript.
 * document.write is intentional here: it gives classic-script deterministic
 * execution order. Production build inlines these sources and skips this file.
 */
(function (G) {
  "use strict";
  const backgrounds = G.BackgroundContent && Array.isArray(G.BackgroundContent.backgrounds) ? G.BackgroundContent.backgrounds : [];
  const loaded = new Set();
  backgrounds.forEach((background) => {
    if (!background || !background.source || loaded.has(background.source)) return;
    loaded.add(background.source);
    const safe = String(background.source).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    document.write('<script src="' + safe + '"></script>');
  });
})(window.Game = window.Game || {});
