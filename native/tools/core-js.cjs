// core-js.cjs — el juego (todas las fuentes de js/files.js) cargado en Node, sin arrancar, como en el hilo del suelo (shim/tiles-worker.js).
// Para comparar el núcleo en C con el JS (native/core/) y sacar sus datos (export-core.cjs). SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const real = p => p.replace('/ROOT/shim/', path.join(REPO, 'native/shim') + '/').replace('/ROOT/game/', REPO + '/');
module.exports = () => {
  const wk = vm.createContext({ console: { log() {}, warn() {}, error() {} }, PS_ALL: true });   // (todo, no sólo el suelo)
  wk.ps = { ROOT: '/ROOT', log() {}, readFile: p => { try { return fs.readFileSync(real(p), 'utf8'); } catch (e) { return null; } },
            load: p => vm.runInContext(fs.readFileSync(real(p), 'utf8'), wk, { filename: real(p) }) };
  vm.runInContext("ps.load('/ROOT/shim/tiles-worker.js')", wk);
  return wk;
};
