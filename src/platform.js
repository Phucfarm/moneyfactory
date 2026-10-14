/* Game-facing platform bridge. Game code calls this file only; host implementations live in src/platform/. */
(function (G) {
  "use strict";

  const host = G.PlatformHost || {};
  const noopScreen = { async enterGameMode() { return {}; }, async exitGameMode() {}, isFullscreen() { return false; } };
  const noopAds = { isAvailable() { return false; }, async showInterstitial() { return { shown: false, rewarded: false }; }, async showRewarded() { return { shown: false, rewarded: false }; } };
  const noopLifecycle = { onPause() {}, onResume() {} };
  const noopAnalytics = { track() {} };

  G.Platform = Object.freeze({
    screen: host.screen || noopScreen,
    ads: host.ads || noopAds,
    lifecycle: host.lifecycle || noopLifecycle,
    analytics: host.analytics || noopAnalytics
  });
})(window.Game = window.Game || {});
