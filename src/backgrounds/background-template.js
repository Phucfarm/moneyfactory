/* Optional interactive background behavior template.
 * Keep gameplay state immutable here. Use CSS for visuals whenever possible.
 */
(function (G) {
  "use strict";

  class ExampleBackgroundBehavior extends G.Background.ZoneBackground {
    onEnter(ctx) {
      this.mouse = { x: 0, y: 0 };
      if (ctx.element) ctx.element.dataset.exampleReady = "1";
    }

    update(ctx) {
      if (!ctx.element) return;
      ctx.element.style.setProperty("--bg-pointer-x", this.mouse.x + "px");
      ctx.element.style.setProperty("--bg-pointer-y", this.mouse.y + "px");
    }

    onPointerMove(ctx) {
      this.mouse = { x: Number(ctx.x) || 0, y: Number(ctx.y) || 0 };
    }
  }

  G.Background.registerBackground("example.background", ExampleBackgroundBehavior);
})(window.Game = window.Game || {});
