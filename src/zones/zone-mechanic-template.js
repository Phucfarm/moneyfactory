/*
 * Zone mechanic template.
 * Every Zone must have at least one JavaScript mechanic declared in JSON.
 *
 * Inheritance example:
 *   class SharedFactoryMechanic extends G.Zone.ZoneMechanic { ... }
 *   class ExampleMechanic extends SharedFactoryMechanic { ... }
 *
 * Keep persistent mechanic data inside the Zone state's mechanicState using
 * this.state()/this.setState()/this.addState(). Do not directly rewrite money,
 * save data, or global progression here; use the framework/core adapters.
 */
(function (G) {
  "use strict";

  class ExampleMechanic extends G.Zone.ZoneMechanic {
    constructor(def) {
      super(def);
      this.maxProgress = Math.max(1, Number(this.config.maxProgress) || 100);
    }

    onBeforeZoneTick(ctx) {
      this.addState(ctx, "progress", Math.max(0, Number(ctx.dt) || 0));
    }

    modifyProduction(ctx, multiplier) {
      const progress = Number(this.state(ctx, "progress", 0)) || 0;
      return multiplier * (1 + Math.min(1, progress / this.maxProgress) * 0.1);
    }

  }

  G.Zone.registerMechanic("example.mechanic", ExampleMechanic);
})(window.Game = window.Game || {});
