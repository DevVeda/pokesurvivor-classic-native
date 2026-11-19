// Firma una actualización (docs/updates.md) y deja en dist/live/ lo que se sube a LIVE_BASE (just publish):
//   news.json · _headers · live/*.json (si existe la carpeta live/)
//   update/version.json · update/version.json.sig · update/shim/*.js · update/game/{index.html,VERSION,news.json,js/**.js}
//   update/packs.json + update/packs/*.bin (los assets de game/assets/** juntos en packs de ~2 MB; el hash de packs.json va
//   firmado en version.json → «packs»)
//   update/native/<id>/** (con --native: los binarios de escritorio ya compilados, sin el juego → «native»)
// node tools/sign-update.mjs [--native] [--min-native N] [--moved-to https://nuevo/update/,https://espejo/]
// Lee UPDATE_SIGN_KEY de .env y nunca lo imprime. Al acabar comprueba lo escrito como lo hará el cliente (verify).
// @step publish/sign
// @step publish/natopt decision "¿Con --native?"
// Añade los binarios de escritorio (macos, windows-x64, linux-x64) con api=UPD_API; salta el que falte
// o sea más viejo que native/.
// @next verify
// @step publish/distlive data "dist/live listo"
// update/ (manifiesto, firma, archivos, packs, native/), news.json, live/*.json si existe la carpeta y
// _headers (CORS, no-cache).
// @next leak "recomendado"
// @next deploy
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, sign, verify as edVerify } from 'node:crypto';
import { dirname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const die = m => { console.error(m); process.exit(1); };

// (el mismo lector de .env que apply-env.mjs)
const env = {};
try {
  for (const line of readFileSync(process.env.ENV_FILE || root + '.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { die('Falta .env (copia env.example a .env y rellénalo).'); }
if (!env.UPDATE_SIGN_KEY) die('Falta UPDATE_SIGN_KEY en .env (cómo crearla: docs/updates.md, «Claves»).');
let key;
try { key = createPrivateKey({ key: Buffer.from(env.UPDATE_SIGN_KEY, 'base64'), format: 'der', type: 'pkcs8' }); }
catch { die('UPDATE_SIGN_KEY no es una clave PKCS8 en base64.'); }
if (key.asymmetricKeyType !== 'ed25519') die('UPDATE_SIGN_KEY no es Ed25519.');
const pub = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12);   // los 32 bytes de la pública

const arg = n => { const i = process.argv.indexOf(n); return i > 1 ? process.argv[i + 1] : undefined; };
const minNative = +(arg('--min-native') ?? 1);
if (!Number.isInteger(minNative) || minNative < 1) die('--min-native: un entero desde 1.');
const movedTo = arg('--moved-to') ? arg('--moved-to').split(',').map(s => s.trim().replace(/\/*$/, '/')) : null;
if (movedTo && movedTo.some(u => !/^https:\/\/[^\s/]+\/\S*$/.test(u))) die('--moved-to: URLs https:// separadas por comas.');
if (!existsSync(root + 'js/env.js')) die('Falta js/env.js: corre antes node tools/apply-env.mjs.');

// Lo que va: el código del juego y de los shims, con la misma forma que stage-game.sh (shim/, game/).
const ls = d => readdirSync(root + d, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && !e.name.startsWith('.'))
  .map(e => (e.parentPath.slice(root.length + d.length + 1) + '/' + e.name).replace(/^\//, '').split('\\').join('/')).sort();
const js = d => ls(d).filter(f => f.endsWith('.js'));
const src = {};
for (const f of js('native/shim')) if (!f.includes('/')) src['shim/' + f] = 'native/shim/' + f;
for (const f of ['index.html', 'VERSION', 'news.json']) src['game/' + f] = f;
for (const f of js('js')) if (f !== 'app.js') src['game/js/' + f] = 'js/' + f;   // (app.js es la web; los puertos cargan las fuentes)
// Los sprites (~13 500 archivos, ~96 MB) van aparte, en packs.json: version.json sigue pequeño y el cliente sólo baja
// packs.json cuando cambia su hash, y de ahí sólo los packs con algún archivo que cambió. Las mismas carpetas que stage-game.sh.
// Packs y no un archivo por asset: el Worker gratis admite 20 000 archivos por versión (y 25 MiB cada uno).
const assetSrc = {};
for (const d of ['fonts', 'icons', 'pokemon', 'banner']) for (const f of ls('assets/' + d)) assetSrc[`game/assets/${d}/${f}`] = `assets/${d}/${f}`;

const out = root + 'dist/live/', up = out + 'update/';
const put = (p, buf) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); };
const sha = buf => createHash('sha512').update(buf).digest('base64');
rmSync(out, { recursive: true, force: true });

const pack = s => {
  const files = {};
  for (const [dst, from] of Object.entries(s)) {
    const buf = readFileSync(root + from);
    put(up + dst, buf);
    files[dst] = { sha512: sha(buf), size: buf.length };
  }
  return files;
};
const files = pack(src);

// Los binarios de escritorio (--native): de lo que dejan just macos / windows / linux en native/build/dist/, el programa sin
// el juego, con rutas relativas a su carpeta (NATIVE_EXE, NATIVE_UP de native/update.c). Uno más viejo que el código de
// native/ no va (se avisa): se publicaría un binario que no es el de ahora.
const native = {};
if (process.argv.includes('--native')) {
  const api = +(readFileSync(root + 'native/update.c', 'utf8').match(/#define UPD_API (\d+)/) || [])[1];
  if (!api) die('No encuentro UPD_API en native/update.c.');
  const newest = ['native', 'native/platform'].flatMap(d => readdirSync(root + d).filter(f => /\.(c|h)$|^Makefile/.test(f))
    .map(f => statSync(root + d + '/' + f).mtimeMs)).reduce((a, b) => Math.max(a, b), 0);
  const PATH = /^[\w.-]+(\/[\w.-]+)*$/;
  // @step publish/natopt
  // @step platforms/publish net "publish --native"
  // Los binarios de escritorio se publican firmados para autoactualización.
  // @sub publish
  // @step desktop/dist data "native/build/dist"
  // Salida de las tres; sign-update --native la lee.
  const NAT = [   // [id, carpeta del programa, qué archivos, el ejecutable]
    // (universal: Intel y Apple Silicon, package-macos.sh)
    ['macos', 'native/build/dist/macos/PokeSurvivor.app',
      p => !p.startsWith('Contents/Resources/') || p === 'Contents/Resources/PokeSurvivor.icns', 'Contents/MacOS/PokeSurvivor'],
    ['windows-x64', 'native/build/dist/windows/PokeSurvivor', p => p === 'PokeSurvivor.exe', 'PokeSurvivor.exe'],
    ['linux-x64', 'native/build/dist/linux/AppDir', p => /^usr\/(bin|lib)\//.test(p), 'usr/bin/pokesurvivor'],
  ];
  for (const [id, dir, want, exe] of NAT) {
    if (!existsSync(root + dir + '/' + exe)) { console.warn(`aviso: --native sin ${id} (no está ${dir}/${exe}: just ${id.split('-')[0]})`); continue; }
    if (statSync(root + dir + '/' + exe).mtimeMs < newest) { console.warn(`aviso: --native sin ${id}: ${dir}/${exe} es más viejo que native/ (just ${id.split('-')[0]})`); continue; }
    if (id.startsWith('linux') && !existsSync(root + dir + '/usr/lib')) { console.warn(`aviso: --native sin ${id}: sin ${dir}/usr/lib (linuxdeploy no acabó: el binario usaría las librerías del sistema)`); continue; }
    const list = ls(dir).filter(want);
    const badPath = list.find(p => !PATH.test(p));
    if (badPath) { console.warn(`aviso: --native sin ${id}: ruta que el cliente no acepta (${badPath})`); continue; }
    const s = {};
    for (const p of list) s[`native/${id}/${p}`] = dir + '/' + p;
    const got = pack(s), nf = {};
    for (const [k, f] of Object.entries(got)) {
      if (f.size > 25 << 20) die(`${k}: más de 25 MiB, el Worker no lo sirve.`);
      nf[k.slice(`native/${id}/`.length)] = f;
    }
    native[id] = { api, files: nf };
  }
  if (!Object.keys(native).length) die('--native: ningún binario que publicar.');
}
// Los assets, en orden, uno detrás de otro en packs de hasta PACK_MAX; cada pack se llama por su contenido.
// ponytail: cortes por tamaño, no por especie: un asset nuevo mueve los cortes de los packs de después (se resuben a CF,
// pero el cliente sólo baja los packs de los archivos que le faltan).
// @step publish/sign
const PACK_MAX = 2 << 20, assetFiles = {}, packs = {};
let cur = [], curN = 0;
const flush = () => {
  if (!cur.length) return;
  const buf = Buffer.concat(cur.map(c => c.buf));
  if (buf.length > 25 << 20) die('Un pack de más de 25 MiB (' + cur[0].dst + '): el Worker no lo sirve.');
  const name = 'packs/' + createHash('sha512').update(buf).digest('hex').slice(0, 16) + '.bin';
  put(up + name, buf);
  packs[name] = buf.length;
  for (const c of cur) assetFiles[c.dst].pack = name;
  cur = []; curN = 0;
};
for (const [dst, from] of Object.entries(assetSrc)) {
  const buf = readFileSync(root + from);
  if (curN && curN + buf.length > PACK_MAX) flush();
  assetFiles[dst] = { sha512: sha(buf), size: buf.length, pack: null, off: curN };
  cur.push({ dst, buf }); curN += buf.length;
}
flush();
const assetsBody = Buffer.from(JSON.stringify({ files: assetFiles, packs }) + '\n');
put(up + 'packs.json', assetsBody);
const manifest = {
  author: env.UPDATE_AUTHOR || '',
  key: pub.toString('base64url'),
  version: readFileSync(root + 'VERSION', 'utf8').trim(),
  build: createHash('sha512').update(JSON.stringify(files)).update(sha(assetsBody)).digest('hex').slice(0, 10),
  // @step publish/sign
  seq: Math.floor(Date.now() / 1000),   // sólo sube: segundos desde 1970 (dos publicaciones en el mismo segundo no pasan)
  date: new Date().toISOString().slice(0, 10),
  minNative,
  files,
  // «packs» y no «assets»: los clientes de antes (assets.json, un archivo por asset) no lo ven y sólo instalan el código,
  // que trae el update.js que ya baja packs.
  packs: { sha512: sha(assetsBody), size: assetsBody.length, count: Object.keys(assetFiles).length },
  movedTo,
  native: Object.keys(native).length ? native : undefined
};
const body = Buffer.from(JSON.stringify(manifest, null, 1) + '\n');
put(up + 'version.json', body);
put(up + 'version.json.sig', sign(null, body, key).toString('base64') + '\n');

// Lo que ya había en LIVE_BASE: el despliegue lo reemplaza todo, así que va siempre.
put(out + 'news.json', readFileSync(root + 'news.json'));
if (existsSync(root + 'live')) for (const f of readdirSync(root + 'live').filter(f => f.endsWith('.json'))) put(out + f, readFileSync(root + 'live/' + f));
put(out + '_headers', '/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache\n');

// Lo que hará el cliente (docs/updates.md, «Cliente»), sobre lo recién escrito: firma, clave, rutas, tamaños y hashes.
// @step publish/verify build "Autoverificación"
// Comprueba firma, clave, rutas, tamaños y SHA-512 como el cliente, y que una copia alterada falle; si
// no, aborta.
// @next distlive "ok"
function verify(dir, pubRaw) {
  const b = readFileSync(dir + 'version.json');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubRaw]);
  const ok = edVerify(null, b, createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(readFileSync(dir + 'version.json.sig', 'utf8').trim(), 'base64'));
  if (!ok) throw new Error('firma');
  const m = JSON.parse(b);
  if (m.key !== pubRaw.toString('base64url')) throw new Error('clave');
  const check = (p, f) => {
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(p) || p.split('/').some(s => s === '..' || s === '.')) throw new Error('ruta ' + p);
    const buf = readFileSync(dir + p);
    if (buf.length !== f.size || sha(buf) !== f.sha512) throw new Error('hash ' + p);
    return buf;
  };
  for (const [p, f] of Object.entries(m.files)) check(p, f);
  for (const [id, n] of Object.entries(m.native || {})) for (const [p, f] of Object.entries(n.files)) check(`native/${id}/${p}`, f);
  // packs.json no lleva firma propia: vale porque su hash está en version.json, ya firmado.
  const a = JSON.parse(check('packs.json', m.packs)), pk = {};
  for (const [n, size] of Object.entries(a.packs)) {
    if (!/^packs\/[0-9a-f]{16}\.bin$/.test(n)) throw new Error('pack ' + n);
    if ((pk[n] = readFileSync(dir + n)).length !== size) throw new Error('tamaño ' + n);
  }
  for (const [p, f] of Object.entries(a.files)) {
    if (!/^game\/assets\//.test(p) || p.split('/').some(s => s === '..' || s === '.')) throw new Error('ruta ' + p);
    const b = pk[f.pack] && pk[f.pack].subarray(f.off, f.off + f.size);
    if (!b || b.length !== f.size || sha(b) !== f.sha512) throw new Error('hash ' + p);
  }
  return m;
}
try { verify(up, pub); } catch (e) { die('La comprobación ha fallado (' + e.message + '): no subas dist/live/.'); }
// @step publish/verify
const tampered = Buffer.from(body); tampered[tampered.length - 2] ^= 1;   // y una copia tocada tiene que fallar
if (edVerify(null, tampered, createPublicKey(key), Buffer.from(readFileSync(up + 'version.json.sig', 'utf8').trim(), 'base64'))) die('La firma no detecta cambios.');

const fp = createHash('sha512').update(pub).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join(' ');
const mb = f => (Object.values(f).reduce((a, x) => a + x.size, 0) / 1e6).toFixed(1);
console.log(`ok: dist/live/ · ${manifest.version} build ${manifest.build} · seq ${manifest.seq} · ${Object.keys(files).length} archivos, ${mb(files)} MB`
  + ` + ${Object.keys(assetFiles).length} de assets, ${mb(assetFiles)} MB en ${Object.keys(packs).length} packs · `
  + `${manifest.author || '(sin autor)'} (${fp})${movedTo ? ' · se muda a ' + movedTo.join(', ') : ''}`
  + (Object.keys(native).length ? ' · binarios: ' + Object.entries(native).map(([id, n]) => `${id} ${mb(n.files)} MB`).join(', ') : ''));
