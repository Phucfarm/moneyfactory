/* ============================================================
   13-tutorial-content.js — Guidance Core content definitions.

   PURE DATA + READ-ONLY PREDICATES. Nothing in this file mutates gameplay
   state, touches the DOM, or knows about CSS selectors. It talks to the
   game only through the read-only context `c` built by 13-tutorial.js and
   refers to UI elements only through semantic target ids
   (catalog.machine, slot, menu.tech, ...), which the engine resolves.

   LAYER 1 (first-time basics)
     select -> place -> collect (+$100) -> place a second machine ->
     Basic Done acknowledgement (+$1,000) -> select next machine -> place it -> done.
     Each step's `done(c)` is derived from real game state/events, never
     from timers. Steps may complete out of order if the player simply plays.

   LAYER 2 (contextual guidance)
     Generators return candidate hints that are relevant RIGHT NOW. The
     engine shows at most one at a time, remembers shown hints by id in
     the guidance store (never in the gameplay save), and only runs them
     when the Settings toggle is ON. Ordinary tips wait until Layer 1 is complete;
     a newly available urgent action can briefly interrupt a visible Layer 1 step.
   ============================================================ */
(function (G) {
  "use strict";

  const D = () => G.DATA;
  const E = () => G.Econ;
  const Z = () => G.Zone;

  // ---------------- Layer 1 ----------------
  const layer1 = {
    steps: [
      {
        id: "select",
        done: (c) => c.flag("selected") || c.machineCount >= 1,
        view: (c) => {
          const id = c.starterMachineId;
          if (c.catalogCollapsed()) {
            return { mode: "spotlight", target: { id: "catalog.toggle" }, text: { key: "tutorial.l1.selectOpen" } };
          }
          return {
            mode: "spotlight",
            target: { id: "catalog.machine", params: { machineId: id }, fallback: { id: "catalog.toggle" } },
            text: { key: "tutorial.l1.select", params: { machine: c.machineName(id) } },
          };
        },
      },
      {
        id: "place1",
        done: (c) => c.machineCount >= 1,
        view: (c) => {
          const id = c.selectedMachineId;
          if (!c.canAfford(id)) return null;
          return {
            mode: "spotlight",
            target: { id: "slot", params: { pick: "empty" } },
            cardAnchor: "top-left",
            text: { key: "tutorial.l1.place1", params: { cost: c.money$(c.cost(id)) } },
          };
        },
      },
      {
        id: "collect",
        done: (c) => c.flag("collected"),
        view: (c) => {
          const slot = c.bestMachineSlot();
          if (!slot) return null;
          return {
            mode: "spotlight",
            target: { id: "slot", params: { pick: "machine" } },
            text: { key: slot.machine.banked > 0 ? "tutorial.l1.collect" : "tutorial.l1.collectWait" },
          };
        },
      },
      {
        id: "place2",
        done: (c) => c.machineCount >= 2,
        view: (c) => {
          const id = c.selectedMachineId;
          if (!c.canAfford(id)) return null;
          return {
            mode: "spotlight",
            target: { id: "slot", params: { pick: "empty" } },
            cardAnchor: "top-left",
            text: { key: "tutorial.l1.place2" },
          };
        },
      },
      {
        id: "basicDone",
        done: (c) => c.flag("basicDoneAcknowledged"),
        view: () => ({
          mode: "card",
          titleKey: "tutorial.l1.basicDone.title",
          text: { key: "tutorial.l1.basicDone" },
          buttons: ["ok"],
        }),
      },
      {
        id: "selectNew",
        done: (c) => c.selectedMachineId === c.nextMachineId,
        view: (c) => {
          const id = c.nextMachineId;
          if (!id) return null;
          if (c.catalogCollapsed()) {
            return { mode: "spotlight", target: { id: "catalog.toggle" }, text: { key: "tutorial.l1.selectNewOpen" } };
          }
          return {
            mode: "spotlight",
            target: { id: "catalog.machine", params: { machineId: id }, fallback: { id: "catalog.toggle" } },
            text: { key: "tutorial.l1.selectNew", params: { machine: c.machineName(id) } },
          };
        },
      },
      {
        id: "place3",
        done: (c) => c.machineCount >= 3,
        view: (c) => {
          const id = c.selectedMachineId;
          if (!c.canAfford(id)) return null;
          return {
            mode: "spotlight",
            target: { id: "slot", params: { pick: "empty" } },
            cardAnchor: "top-left",
            text: { key: "tutorial.l1.place3", params: { machine: c.machineName(id), cost: c.money$(c.cost(id)) } },
          };
        },
      },
    ],
  };

  // ---------------- Layer 2 ----------------
  const zoneName = (c, id) => { const z = D().zoneById(id); return z ? c.t(z.nameKey) : id; };

  const generators = [
    // Machine status contributed by a Zone mechanic (e.g. a disabled machine).
    // Text comes from the mechanic's own labelKey/detailKey: no per-zone branches.
    function machineStatus(c) {
      const out = [];
      const floorId = c.state.currentFloorId;
      (c.mechanicUi.machineStatuses || []).forEach((st) => {
        if (!st || st.floorId !== floorId) return;
        out.push({
          id: "status:" + st.statusId, priority: 85, mode: "bubble",
          tagKey: "tutorial.l2.tag.status",
          title: c.t(st.labelKey, st.params), text: st.detailKey ? c.t(st.detailKey, st.params) : "",
          target: { id: "slot", params: { pick: "at", r: st.r, c: st.c } },
        });
      });
      return out;
    },

    // Zone mechanic actions (buttons rendered by the generic mechanic UI).
    function mechanicAction(c) {
      const out = [];
      (c.mechanicUi.actions || []).forEach((a) => {
        if (!a || a.disabled) return;
        out.push({
          id: "action:" + a.mechanicId + ":" + a.id, priority: 80, mode: "bubble",
          tagKey: "tutorial.l2.tag.action", title: c.t(a.labelKey), text: c.t("tutorial.l2.action.text"),
          target: { id: "mechanic.action", params: { mechanicId: a.mechanicId, actionId: a.id } },
        });
      });
      return out;
    },

    // Zone-wide indicators (timed effects etc.).
    function zoneIndicator(c) {
      const out = [];
      (c.mechanicUi.zoneIndicators || []).forEach((ind, index) => {
        if (!ind) return;
        out.push({
          id: "indicator:" + ind.id, priority: 75, mode: "bubble",
          tagKey: "tutorial.l2.tag.indicator", title: c.t(ind.labelKey, ind.params),
          text: ind.detailKey ? c.t(ind.detailKey, ind.params) : "",
          target: { id: "mechanic.indicator", params: { index } },
        });
      });
      return out;
    },

    // Bonus star on a machine (observed from the existing bonusReady event).
    function bonusStar(c) {
      const b = c.events.bonus;
      if (!b || c.now - b.at > 12000) return [];
      if (b.floorId !== c.state.currentFloorId || b.zoneId !== c.state.currentZoneId) return [];
      return [{
        id: "bonus", priority: 70, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
        titleKey: "tutorial.l2.bonus.title", text: c.t("tutorial.l2.bonus.text"),
        target: { id: "slot", params: { pick: "at", r: b.r, c: b.c } },
      }];
    },

    // A Zone machine whose manual unlock the player can now afford.
    function zoneMachineUnlock(c) {
      const out = [];
      (D().ZONE_MACHINE_DEFS || []).forEach((def) => {
        let st; try { st = Z().machineUnlockStatus(c.state, def.id, c.state.currentZoneId); } catch (_) { return; }
        if (!st || st.reason === "zoneLocked" || st.already || !st.manual || (st.missing && st.missing.length) || !st.canPay) return;
        out.push({
          id: "zoneMachine:" + def.id + ":available", priority: 97, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          titleKey: "tutorial.l2.zoneMachine.title",
          text: c.t("tutorial.l2.zoneMachine.text", { machine: c.machineName(def.id), cost: c.money$(st.cost) }),
          target: { id: "catalog.machine", params: { machineId: def.id }, fallback: { id: "catalog.toggle" } },
        });
      });
      return out;
    },

    // A locked Zone that can be unlocked right now.
    function zoneUnlock(c) {
      const out = [];
      D().ZONES.forEach((zd, index) => {
        if (!zd.unlock) return;
        let st; try { st = Z().zoneUnlockStatus(c.state, zd.id); } catch (_) { return; }
        if (!st || st.already || !st.ok) return;
        out.push({
          id: "zone:" + zd.id + ":guided", priority: 98, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          titleKey: "tutorial.l2.zone.title",
          text: c.t("tutorial.l2.zone.text", { zone: zoneName(c, zd.id), cost: c.money$(st.cost) }),
          target: { id: "zone.unlock", params: { zoneId: zd.id }, fallback: { id: "zone.button", params: { index } } },
        });
      });
      return out;
    },

    // A locked floor of the current Zone that can be unlocked right now.
    function floorUnlock(c) {
      const out = [];
      const zd = D().zoneById(c.state.currentZoneId);
      if (!zd) return out;
      zd.floors.forEach((fd, index) => {
        let st; try { st = Z().floorUnlockStatus(c.state, zd.id, fd.id); } catch (_) { return; }
        if (!st || st.already || !st.ok) return;
        out.push({
          id: "floor:" + zd.id + ":" + fd.id + ":guided", priority: 96, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          titleKey: "tutorial.l2.floor.title",
          text: c.t("tutorial.l2.floor.text", { floor: c.t(fd.nameKey), cost: c.money$(st.cost) }),
          target: { id: "floor.button", params: { index } },
        });
      });
      return out;
    },

    // A secret/discovery should be acknowledged on the same refresh in which Core
    // reports it. This covers discoveries triggered by purchases/upgrades as well as
    // requirement checks during simulation.
    function secretDiscovery(c) {
      if (!Z() || typeof Z().getZoneSecrets !== "function") return [];
      let secrets = [];
      try { secrets = Z().getZoneSecrets(c.state, c.state.currentZoneId) || []; } catch (_) { return []; }
      return secrets.filter((secret) => secret && secret.discovered).map((secret) => ({
        id: "secret:" + c.state.currentZoneId + ":" + secret.id,
        priority: 100, urgent: true, mode: "card", tagKey: "tutorial.l2.tag.mechanic",
        title: c.t(secret.nameKey),
        text: c.t(secret.descriptionKey || secret.hintKey),
        target: { id: "none" },
      }));
    },

    // Introduce a Zone's known mechanics as soon as the player enters it. Requiring
    // a placed machine here made hints disappear when the player entered a new Zone
    // before building, despite the Zone and its mechanics already being available.
    // Hidden mechanics remain excluded until Core marks them discovered.
    function mechanicIntro(c) {
      const out = [];
      const zd = D().zoneById(c.state.currentZoneId);
      if (!zd) return out;
      let list = [];
      try { list = Z().getZoneMechanics(c.state, zd.id) || []; } catch (_) { return out; }
      list.forEach((m) => {
        if (!m.discovered) return;
        out.push({
          id: "mechanic:" + zd.id + ":" + m.id,
          priority: 99, urgent: true, mode: "card",
          tagKey: "tutorial.l2.tag.mechanic", title: c.t(m.nameKey), text: c.t(m.descriptionKey),
          target: { id: "none" },
        });
      });
      return out;
    },

    // Surface machine upgrades as soon as one is affordable, even while the
    // inspector is closed. The same active hint retargets itself to the upgrade
    // button after the player opens the machine panel.
    function machineUpgrade(c) {
      const ready = c.ui.upgradeReady();
      const slot = c.ui.upgradeSlot();
      if (!ready && !slot) return [];
      // Include slot, upgrade type and level so a later upgrade remains a new hint.
      const upgradeKey = slot ? slot.r + ":" + slot.c + ":" + slot.upgradeId + ":" + slot.level : "panel";
      return [{
        id: "machineUpgrade:" + upgradeKey, priority: 93, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
        titleKey: "tutorial.l2.upgrade.title",
        text: c.t(ready ? "tutorial.l2.upgrade.text" : "tutorial.l2.upgrade.select"),
        target: ready ? { id: "machinePanel.upgrade" } : { id: "slot", params: { pick: "at", r: slot.r, c: slot.c } },
      }];
    },

    // Unspent Skill Points.
    function skillPoint(c) {
      if (!(Number(c.state.skills && c.state.skills.points) > 0)) return [];
      return [{
        id: "skill", priority: 40, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
        titleKey: "tutorial.l2.skill.title", text: c.t("tutorial.l2.skill.text"),
        target: { id: "menu", params: { panel: "tech" } },
      }];
    },

    // Global functional rooms: teach each room the first time its next level is affordable.
    // When Rooms is closed, point at the Rooms menu; after opening it, retarget the action.
    function roomUpgrade(c) {
      if (!Z()) return [];
      const out = [];
      Object.keys(D().ROOMS || {}).forEach((roomId) => {
        const def = D().ROOMS[roomId];
        const saved = c.state.rooms && c.state.rooms[roomId];
        if (!def || !saved) return;
        const level = Math.max(0, Number(saved.level) || 0);
        if (level >= def.maxLevel) return;
        let cost;
        try { cost = E().roomCost(roomId, level); } catch (_) { return; }
        if (!Number.isFinite(cost) || c.state.money < cost) return;
        const name = c.t(def.nameKey);
        out.push({
          id: "rooms:room:" + roomId + ":level:" + level + ":affordable", priority: 94, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          title: name,
          text: c.t("tutorial.l2.room.text", { description: c.t("room." + roomId + ".desc"), cost: c.money$(cost) }),
          target: { id: "rooms.room", params: { roomId }, fallback: { id: "menu", params: { panel: "rooms" } } },
        });
      });
      return out;
    },

    // Floor systems: Conveyor Belts and Auto-Collectors; state and price come from Core.
    function floorSystemUpgrade(c) {
      if (!Z()) return [];
      const floor = c.currentFloor;
      if (!floor || !floor.systems) return [];
      const out = [];
      Object.keys(D().FLOOR_SYSTEMS || {}).forEach((systemId) => {
        const def = D().FLOOR_SYSTEMS[systemId];
        const level = Math.max(0, Number(floor.systems[systemId]) || 0);
        if (!def || level >= def.maxLevel) return;
        let cost;
        try { cost = E().floorSystemCost(systemId, level, c.state); } catch (_) { return; }
        if (!Number.isFinite(cost) || c.state.money < cost) return;
        const title = c.t("floorsys." + systemId);
        out.push({
          id: "rooms:floor:" + systemId + ":level:" + level + ":affordable", priority: 94, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          title,
          text: c.t("tutorial.l2.floorSystem.text", { description: c.t("floorsys." + systemId + ".desc"), cost: c.money$(cost) }),
          target: { id: "rooms.floorSystem", params: { systemId }, fallback: { id: "menu", params: { panel: "rooms" } } },
        });
      });
      return out;
    },

    // Zone-specific Upgrades/Purchases rendered in the same Rooms panel.
    // Hidden or locked entries are deliberately excluded until Core says they are visible and buyable.
    function zoneLocalContent(c) {
      if (!Z()) return [];
      const zoneDef = D().zoneById(c.state.currentZoneId);
      if (!zoneDef) return [];
      const out = [];
      const entries = [
        ...(zoneDef.upgrades || []).map((def) => ({ def, kind: "upgrade" })),
        ...(zoneDef.purchases || []).map((def) => ({ def, kind: "purchase" })),
      ];
      entries.forEach(({ def, kind }) => {
        if (!def || !def.id) return;
        let status;
        try { status = Z().zoneContentStatus(c.state, zoneDef.id, def.id, kind); } catch (_) { return; }
        if (!status || !status.visible || !status.ok) return;
        const name = c.t(def.nameKey);
        out.push({
          id: "rooms:zone:" + zoneDef.id + ":" + kind + ":" + def.id + ":level:" + status.level + ":affordable",
          priority: 95, urgent: true, mode: "bubble", tagKey: "tutorial.l2.tag.tip",
          title: name,
          text: c.t("tutorial.l2.zoneContent.text", { description: def.descriptionKey ? c.t(def.descriptionKey) : "", zone: c.t(zoneDef.nameKey), kind: c.t(kind === "purchase" ? "tutorial.l2.zoneContent.purchase" : "tutorial.l2.zoneContent.upgrade"), cost: c.money$(status.cost) }),
          target: { id: "rooms.zoneContent", params: { contentId: def.id, kind }, fallback: { id: "menu", params: { panel: "rooms" } } },
        });
      });
      return out;
    },

  ];

  G.TutorialContent = {
    layer1,
    layer2: { generators, firstGapMs: 7000, gapMs: 4500, maxVisibleMs: 22000 },
  };
})(window.Game = window.Game || {});
