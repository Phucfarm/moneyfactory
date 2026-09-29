/* Development/source-mode loader for Zone mechanic JS files. Production build inlines them. */
(function (G) {
  "use strict";
  const zones = G.ZoneContent && Array.isArray(G.ZoneContent.zones) ? G.ZoneContent.zones : [];
  const loaded = new Set();
  zones.forEach((zone) => (zone.mechanics || []).forEach((mechanic) => {
    if (!mechanic.source || loaded.has(mechanic.source)) return;
    loaded.add(mechanic.source);
    document.write('<script src="' + String(mechanic.source).replace(/"/g, '&quot;') + '"><\\/script>');
  }));
})(window.Game = window.Game || {});
