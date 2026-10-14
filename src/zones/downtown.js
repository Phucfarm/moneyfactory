/* Starter Zone mechanic: lightweight operational telemetry.
 * It intentionally does not modify economy so the original starter balance stays intact.
 */
(function (G) {
  "use strict";

  class StarterOperationsMechanic extends G.Zone.ZoneMechanic {
    onMachineCycle(ctx) {
      this.addState(ctx, "cyclesObserved", 1, 0);
    }

    onMachinePlaced(ctx) {
      this.addState(ctx, "machinesObserved", 1, 0);
    }

    onMachineCollected(ctx) {
      this.addState(ctx, "collectionsObserved", 1, 0);
    }
  }

  G.Zone.registerMechanic("downtown.operations", StarterOperationsMechanic);
})(window.Game = window.Game || {});
