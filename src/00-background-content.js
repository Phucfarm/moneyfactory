/* GENERATED FROM content/backgrounds.json — DO NOT EDIT. */
window.Game = window.Game || {};
window.Game.BackgroundContent = {
  "schemaVersion": 2,
  "backgrounds": [
    {
      "id": "bg.downtown",
      "nameKey": "background.downtown.name",
      "className": "zone-background--downtown",
      "cssSource": "src/backgrounds/downtown.css",
      "css": {
        "background": "radial-gradient(circle at 50% 18%, rgba(79,122,162,.18), transparent 36%), radial-gradient(circle at 82% 76%, rgba(61,220,132,.08), transparent 34%), linear-gradient(145deg, #0d1117 0%, #171b22 42%, #0b0f14 100%)",
        "backgroundSize": "auto, auto, 100% 100%",
        "backgroundPosition": "center, center, center"
      },
      "cssText": "\n/* Zone background stylesheet: Downtown Warehouse. Purely visual. */\n#zone-background.zone-background--downtown::before {\n  content: \"\";\n  position: absolute;\n  inset: 7% 8% 10%;\n  border: 1px solid rgba(255,255,255,.025);\n  border-radius: 22px;\n  background:\n    linear-gradient(90deg, transparent 49.8%, rgba(255,255,255,.025) 50%, transparent 50.2%),\n    linear-gradient(0deg, transparent 49.8%, rgba(255,255,255,.02) 50%, transparent 50.2%);\n  background-size: 86px 86px;\n  mask-image: linear-gradient(to bottom, transparent, black 12%, black 88%, transparent);\n  opacity: .55;\n  pointer-events: none;\n}\n"
    },
    {
      "id": "bg.ocean",
      "nameKey": "background.ocean.name",
      "className": "zone-background--ocean",
      "cssSource": "src/backgrounds/ocean.css",
      "script": "ocean.abyss",
      "source": "src/backgrounds/ocean.js",
      "config": {
        "lightShaftCount": 5,
        "bubbleCount": 20,
        "siltCount": 34,
        "kelpClumpCount": 8,
        "visualFps": 30,
        "kelpCount": 9,
        "coralCount": 7,
        "backgroundFishCount": 6,
        "backgroundFishSpecies": [
          "tide_minnow",
          "glassfin_darter",
          "moonspot_koi",
          "abyssal_glowfish",
          "crown_sea_dragon"
        ],
        "backgroundBubbleCount": 16,
        "backgroundSiltCount": 18
      },
      "css": {
        "background": "radial-gradient(ellipse at 50% 8%, rgba(130,224,255,.24), transparent 27%), radial-gradient(ellipse at 14% 52%, rgba(0,182,214,.11), transparent 34%), radial-gradient(ellipse at 82% 38%, rgba(25,119,153,.13), transparent 38%), linear-gradient(180deg, #0e6074 0%, #0a4259 22%, #063042 51%, #021d2b 78%, #010d16 100%)",
        "backgroundSize": "100% 100%",
        "backgroundPosition": "center"
      },
      "cssText": "/* ============================================================\n   bg.ocean — submerged deep-ocean presentation.\n   Visual-only: no gameplay/state mutation belongs here.\n\n   IMPORTANT: the single base background is declared in\n   content/backgrounds.json. This stylesheet only provides the\n   supporting layers used by the Ocean background behavior.\n   ============================================================ */\n.zone-background--ocean {\n  --ocean-depth: #02131d;\n  --ocean-mid: #063246;\n  --ocean-blue: #0b5b72;\n  --ocean-light: rgba(136, 230, 255, .16);\n  --ocean-caustic: rgba(116, 234, 255, .14);\n  --ocean-pointer-x: 50%;\n  --ocean-pointer-y: 24%;\n  --ocean-activity: .35;\n  isolation: isolate;\n}\n\n/* The base Ocean color/light field is defined once in content/backgrounds.json. */\n\n.zone-background--ocean::after {\n  content:\"\";\n  position:absolute;\n  inset:0;\n  z-index:8;\n  pointer-events:none;\n  background:\n    radial-gradient(ellipse at 50% 0%,transparent 0 38%,rgba(0,9,15,.08) 62%,rgba(0,6,12,.48) 100%),\n    linear-gradient(180deg,transparent 0 70%,rgba(0,7,11,.22) 84%,rgba(0,4,8,.56) 100%);\n}\n\n.ocean-bg-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;transform:translateZ(0)}\n.ocean-depth-haze{z-index:2}\n.ocean-life{z-index:5;contain:layout paint style}\n.ocean-life-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}\n.ocean-seafloor{z-index:6;top:auto;bottom:0;height:24%;opacity:.9}\n\n/* This layer is intentionally static. Moving light shafts are rendered in\n   ocean.js to avoid mobile GPU compositor flicker from animated blur/blend. */\n.ocean-haze{\n  position:absolute;\n  inset:0;\n  background:\n    radial-gradient(ellipse at 23% 34%,rgba(86,205,233,.08),transparent 31%),\n    radial-gradient(ellipse at 76% 48%,rgba(55,148,188,.065),transparent 34%),\n    linear-gradient(180deg,rgba(88,203,228,.035),transparent 34%,rgba(0,30,43,.18) 100%);\n}\n\n.ocean-seafloor{\n  background:\n    radial-gradient(ellipse at 21% 55%,rgba(74,100,73,.16),transparent 29%),\n    radial-gradient(ellipse at 66% 48%,rgba(55,84,69,.11),transparent 32%),\n    linear-gradient(180deg,transparent 0,rgba(3,25,25,.28) 22%,rgba(1,11,14,.9) 100%);\n}\n.ocean-seafloor::after{\n  content:\"\";\n  position:absolute;\n  left:0;right:0;bottom:0;height:28%;\n  background:\n    repeating-linear-gradient(8deg,rgba(125,149,109,.035) 0 2px,transparent 2px 16px),\n    linear-gradient(180deg,rgba(30,57,49,.06),rgba(0,0,0,.32));\n  filter:blur(1px);\n}\n\n@media (max-width:700px){\n  .zone-background--ocean::before{opacity:.9}\n}\n"
    }
  ]
};
