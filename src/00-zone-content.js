/* GENERATED FROM content/zones.json — DO NOT EDIT. */
window.Game = window.Game || {};
window.Game.ZoneContent = {
  "schemaVersion": 4,
  "zones": [
    {
      "id": "zone_downtown",
      "order": 0,
      "nameKey": "zone.downtown.name",
      "descriptionKey": "zone.downtown.desc",
      "backgroundId": "bg.downtown",
      "theme": {
        "background": "#171b22",
        "floor": "#22262f",
        "tileA": "rgba(255,255,255,0.02)",
        "tileB": "rgba(255,255,255,0.045)",
        "grid": "rgba(255,255,255,0.06)"
      },
      "unlock": null,
      "stats": {
        "contentTag": "starter",
        "intendedMachineCount": 8,
        "secretCount": 0
      },
      "floors": [
        {
          "id": "z1f1",
          "nameKey": "floor.1",
          "unlock": null
        },
        {
          "id": "z1f2",
          "nameKey": "floor.2",
          "unlock": {
            "type": "money",
            "amount": 8000
          }
        }
      ],
      "machines": [],
      "mechanics": [
        {
          "id": "downtown_flow",
          "script": "downtown.operations",
          "source": "src/zones/downtown.js",
          "config": {},
          "initialState": {},
          "nameKey": "mechanic.downtownOperations.name",
          "descriptionKey": "mechanic.downtownOperations.desc"
        }
      ],
      "secrets": [],
      "variables": {},
      "upgrades": [],
      "purchases": []
    },
    {
      "id": "zone_ocean",
      "order": 1,
      "nameKey": "zone.ocean.name",
      "descriptionKey": "zone.ocean.desc",
      "backgroundId": "bg.ocean",
      "theme": {
        "background": "#062333",
        "floor": "#0b3145",
        "tileA": "rgba(88,202,227,0.035)",
        "tileB": "rgba(24,132,168,0.075)",
        "grid": "rgba(124,224,245,0.12)"
      },
      "unlock": {
        "requirements": [
          {
            "type": "maxMoney",
            "value": 50000000,
            "op": "gte"
          },
          {
            "type": "mps",
            "value": 120000,
            "op": "gte"
          }
        ],
        "cost": 25000000
      },
      "stats": {
        "contentTag": "ocean",
        "intendedMachineCount": 2,
        "secretCount": 1,
        "mechanicCount": 4
      },
      "floors": [
        {
          "id": "z2f1",
          "nameKey": "floor.ocean1.name",
          "unlock": null
        }
      ],
      "machines": [
        {
          "id": "ocean_abyssal_press",
          "nameKey": "machine.oceanAbyssal.name",
          "descKey": "machine.oceanAbyssal.desc",
          "baseCost": 80000000,
          "costGrowth": 1.22,
          "baseCooldown": 0.65,
          "baseYield": 80000,
          "critChance": 0.09,
          "critMult": 3.8,
          "particleDensity": 1.9,
          "order": 8,
          "color": "#1e9bc4",
          "glow": "#76e7ff",
          "tags": [
            "ocean",
            "ocean_machine",
            "pressure_burst"
          ],
          "visual": {
            "shape": "abyssal"
          },
          "unlock": {
            "manual": true,
            "requirements": [
              {
                "type": "maxMoney",
                "value": 80000000,
                "op": "gte"
              }
            ],
            "cost": 60000000
          },
          "zoneId": "zone_ocean",
          "kind": "zone"
        },
        {
          "id": "ocean_leviathan_mint",
          "nameKey": "machine.oceanLeviathan.name",
          "descKey": "machine.oceanLeviathan.desc",
          "baseCost": 900000000,
          "costGrowth": 1.24,
          "baseCooldown": 0.45,
          "baseYield": 850000,
          "critChance": 0.13,
          "critMult": 4.2,
          "particleDensity": 2.5,
          "order": 9,
          "color": "#35d0b0",
          "glow": "#b8fff3",
          "tags": [
            "ocean",
            "ocean_machine",
            "tidal_resonance"
          ],
          "visual": {
            "shape": "leviathan"
          },
          "unlock": {
            "manual": true,
            "requirements": [
              {
                "type": "machineUnlocked",
                "machineId": "ocean_abyssal_press",
                "value": 1,
                "op": "eq"
              },
              {
                "type": "maxMoney",
                "value": 350000000,
                "op": "gte"
              }
            ],
            "cost": 300000000
          },
          "zoneId": "zone_ocean",
          "kind": "zone"
        }
      ],
      "mechanics": [
        {
          "id": "ocean_water_exposure",
          "script": "ocean.waterExposure",
          "source": "src/zones/ocean.js",
          "config": {
            "infectionChancePerSecond": 0.0028,
            "normalDurationSeconds": 8.5,
            "zoneMachineDurationSeconds": 3.5
          },
          "initialState": {
            "clock": 0,
            "machines": {}
          },
          "nameKey": "mechanic.oceanWaterExposure.name",
          "descriptionKey": "mechanic.oceanWaterExposure.desc"
        },
        {
          "id": "ocean_cold_currents",
          "script": "ocean.coldCurrents",
          "source": "src/zones/ocean.js",
          "nameKey": "mechanic.oceanColdCurrents.name",
          "descriptionKey": "mechanic.oceanColdCurrents.desc",
          "config": {
            "baseSpeedMultiplier": 1.2,
            "currentChancePerSecond": 0.008,
            "currentDurationSeconds": 10,
            "currentSpeedMultiplier": 1.5
          },
          "initialState": {
            "clock": 0,
            "currentUntil": 0,
            "currentCount": 0
          }
        },
        {
          "id": "ocean_machine_systems",
          "script": "ocean.machineSystems",
          "source": "src/zones/ocean.js",
          "config": {
            "abyssalBurstEveryCycles": 8,
            "abyssalBurstMultiplier": 2.75,
            "leviathanResonanceStartCycle": 5,
            "leviathanResonancePerStack": 0.07,
            "leviathanResonanceMaxStacks": 5
          },
          "initialState": {
            "machines": {}
          },
          "nameKey": "mechanic.oceanMachineSystems.name",
          "descriptionKey": "mechanic.oceanMachineSystems.desc"
        },
        {
          "id": "ocean_stranded_fish",
          "script": "ocean.strandedFish",
          "source": "src/zones/ocean.js",
          "visibility": {
            "hidden": true,
            "hintKey": "mechanic.oceanStrandedFish.hint",
            "requirements": [
              {
                "type": "secretDiscovered",
                "secretId": "ocean_stranded_signal",
                "value": 1,
                "op": "gte"
              }
            ]
          },
          "config": {
            "spawnChancePerSecond": 0.004,
            "maxConcurrentFish": 5,
            "autoCatchDelaySeconds": 1.1,
            "species": [
              {
                "id": "tide_minnow",
                "nameKey": "fish.tideMinnow.name",
                "rarityKey": "fish.rarity.common",
                "weight": 55,
                "durationSeconds": 24,
                "reward": 150000,
                "accent": "#5fd7f4",
                "secondary": "#2f93c7",
                "highlight": "#b8f5ff",
                "pattern": "stripes"
              },
              {
                "id": "glassfin_darter",
                "nameKey": "fish.glassfinDarter.name",
                "rarityKey": "fish.rarity.uncommon",
                "weight": 25,
                "durationSeconds": 18,
                "reward": 450000,
                "accent": "#56d8c4",
                "secondary": "#258c9d",
                "highlight": "#b6fff5",
                "pattern": "glass"
              },
              {
                "id": "moonspot_koi",
                "nameKey": "fish.moonspotKoi.name",
                "rarityKey": "fish.rarity.rare",
                "weight": 12,
                "durationSeconds": 13.5,
                "reward": 1400000,
                "accent": "#f1dccb",
                "secondary": "#de95ac",
                "highlight": "#fff8ef",
                "pattern": "spots"
              },
              {
                "id": "abyssal_glowfish",
                "nameKey": "fish.abyssalGlowfish.name",
                "rarityKey": "fish.rarity.epic",
                "weight": 6,
                "durationSeconds": 9.5,
                "reward": 4500000,
                "accent": "#a06cff",
                "secondary": "#5d25c7",
                "highlight": "#eedbff",
                "pattern": "glow"
              },
              {
                "id": "crown_sea_dragon",
                "nameKey": "fish.crownSeaDragon.name",
                "rarityKey": "fish.rarity.mythic",
                "weight": 2,
                "durationSeconds": 7.5,
                "reward": 15000000,
                "accent": "#ff5b79",
                "secondary": "#c62d4f",
                "highlight": "#ffd36b",
                "pattern": "crown"
              }
            ]
          },
          "initialState": {
            "clock": 0,
            "machines": {},
            "fishCaught": 0,
            "fishSpawned": 0
          },
          "nameKey": "mechanic.oceanStrandedFish.name",
          "descriptionKey": "mechanic.oceanStrandedFish.desc",
          "ui": {
            "catalog": "species"
          }
        }
      ],
      "secrets": [
        {
          "id": "ocean_stranded_signal",
          "nameKey": "secret.oceanStrandedSignal.name",
          "hintKey": "secret.oceanStrandedSignal.hint",
          "descriptionKey": "secret.oceanStrandedSignal.desc",
          "discovery": {
            "requirements": [
              {
                "type": "machineCount",
                "scope": "zone",
                "tag": "ocean_machine",
                "value": 5,
                "op": "gte"
              }
            ]
          }
        }
      ],
      "variables": {
        "waterResistance": 0,
        "fishCatcherEnabled": false
      },
      "upgrades": [
        {
          "id": "ocean_waterproofing",
          "nameKey": "zone.oceanWaterproofing.name",
          "descriptionKey": "zone.oceanWaterproofing.desc",
          "icon": "💧",
          "maxLevel": 5,
          "cost": {
            "base": 25000000,
            "growth": 4.8
          },
          "effects": [
            {
              "target": "waterResistance",
              "operation": "add",
              "value": 0.2
            }
          ]
        }
      ],
      "purchases": [
        {
          "id": "ocean_fish_catcher",
          "nameKey": "zone.oceanFishCatcher.name",
          "descriptionKey": "zone.oceanFishCatcher.desc",
          "icon": "🪝",
          "maxLevel": 1,
          "cost": 10000000,
          "unlock": {
            "requirements": [
              {
                "type": "secretDiscovered",
                "secretId": "ocean_stranded_signal",
                "value": 1,
                "op": "gte"
              }
            ]
          },
          "effects": [
            {
              "target": "fishCatcherEnabled",
              "operation": "set",
              "value": true
            }
          ],
          "visibility": {
            "hidden": true,
            "requirements": [
              {
                "type": "secretDiscovered",
                "secretId": "ocean_stranded_signal",
                "value": 1,
                "op": "gte"
              }
            ]
          }
        }
      ]
    }
  ]
};
