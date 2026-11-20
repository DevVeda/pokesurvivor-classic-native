// node native/shim/minver.test.cjs — la versión mínima para jugar online (G.Social.onlineOk, config/online en Firestore) con un Firestore de mentira.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
async function run(version, min, reads) {
  let n = 0;
  const doc = { get: async () => { n++; if (min === 'err') throw Error('red'); return min == null ? { exists: false } : { exists: true, data: () => ({ min }) }; } };
  const fb = { uid: 'ana', fs: { collection: c => { if (c !== 'config') throw Error('solo config'); return { doc: () => doc }; } } };
  const G = { ENV: { version }, DB: { online: true, fb, onLeave() {} }, U: { ls: { get: () => 'Ana', set() {}, json: () => ({}) } } };
  const ctx = vm.createContext({ G, console: { log() {}, warn() {} }, fetch: () => new Promise(() => {}), Date, Map, Set, Promise, Error, Object, String, parseInt, setTimeout, clearTimeout, firebase: {} });
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../../js/online/social.js'), 'utf8'), ctx);
  await G.Social.start().catch(() => {});
  const ok = await G.Social.onlineOk(); await G.Social.onlineOk();
  if (reads != null) assert.equal(n, reads, 'lecturas de config/online');
  return ok;
}
(async () => {
  assert.equal(await run('1.0.2', null), true);          // sin documento: se deja
  assert.equal(await run('1.0.2', 10002, 1), true);      // igual al mínimo; una sola lectura por sesión
  assert.equal(await run('1.0.1', 10002), false);        // vieja
  assert.equal(await run('1.0.10', 10009), true);        // 1.0.10 > 1.0.9 (no es orden de texto)
  assert.equal(await run('1.0.2', 'err', 2), true);      // sin red: se deja y se reintenta
  console.log('versión mínima online: bien');
})().catch(e => { console.error(e); process.exit(1); });
