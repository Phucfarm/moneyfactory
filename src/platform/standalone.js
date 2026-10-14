/* Standalone host implementation. Replace this file with the host-specific implementation later. */
(function (G) {
  "use strict";

  const Standalone = {
    screen: {
      async enterGameMode() {
        let fullscreen = false;
        let landscape = false;
        try {
          const root = document.documentElement;
          if (document.fullscreenElement !== root && root.requestFullscreen) {
            await root.requestFullscreen({ navigationUI: "hide" });
            fullscreen = true;
          } else {
            fullscreen = !!document.fullscreenElement;
          }
        } catch (_) {}

        try {
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock("landscape");
            landscape = true;
          }
        } catch (_) {}

        return { fullscreen, landscape };
      },
      async exitGameMode() {
        try {
          if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
        } catch (_) {}
      },
      isFullscreen() {
        return !!document.fullscreenElement;
      }
    },
    ads: {
      isAvailable() { return false; },
      async showInterstitial() { return { shown: false, rewarded: false }; },
      async showRewarded() { return { shown: false, rewarded: false }; }
    },
    lifecycle: {
      onPause() {},
      onResume() {}
    },
    analytics: {
      track() {}
    }
  };

  G.PlatformHost = Standalone;
})(window.Game = window.Game || {});
