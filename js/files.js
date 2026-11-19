// files.js — las fuentes del juego en su orden de carga (cada una usa lo que dejan en G las de antes). Archivo nuevo: aquí.
// tools/app-js.mjs las junta en js/app.js (la web); los puertos nativos las cargan sueltas (native/shim/boot.js,
// tiles-worker.js y native/tools/core-js.cjs).
globalThis.PS_FILES = [
  'core/util', 'core/hz', 'core/i18n', 'data/lang-en', 'core/settings', 'data/music', 'data/pokedex', 'data/sprites-meta',
  'online/firebase-config', 'online/db', 'core/audio', 'core/input', 'core/touch', 'core/gamepad', 'core/sprites',
  'core/skins', 'systems/halloween', 'core/camera', 'data/moves', 'data/natures', 'data/abilities', 'data/tms',
  'data/types', 'data/starters', 'data/enemies', 'data/upgrades', 'data/items', 'data/shop', 'data/missions',
  'data/achievements', 'data/funding', 'data/changelog', 'data/banner', 'game/tiles', 'game/world', 'game/vfx',
  'game/fx', 'game/projectile', 'game/enemy', 'game/pickup', 'game/player', 'game/stats', 'game/mons',
  'data/ability-fx', 'game/combat', 'game/spawner', 'game/levelup', 'systems/gacha', 'game/interact', 'game/rift',
  'game/judgment', 'game/events', 'game/weather', 'game/pathing', 'systems/progress', 'game/hazards', 'game/orbs',
  'online/rooms-ws', 'online/social', 'online/codec', 'online/net', 'online/coop', 'online/ranking', 'menu/icons',
  'menu/ui', 'game/hud', 'menu/slots', 'menu/shop-ui',
  'game/run-ui', 'menu/social-ui', 'online/gifts',
  'core/updater',
  'game/game', 'main',
].map(f => `js/${f}.js`);
