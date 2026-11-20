// Lee .env y genera los archivos que dependen de él (todos en .gitignore):
//   js/env.js            → window.PS_ENV: SÓLO valores públicos (los ve el navegador)
//   firestore.gen.rules  → firestore.rules con los uid de admin
//   BUILD                → el hash corto del commit (nombres de los paquetes)
// node tools/apply-env.mjs
// Nunca imprime valores: sólo nombres de variables.
// @step publish/envjs data "js/env.js generado"
// window.PS_ENV (sólo valores públicos) y firestore.gen.rules con los uid de admin. Entra en todos los
// builds.
// @next sign
// @step publish/envjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
let raw;
try { raw = readFileSync(process.env.ENV_FILE || root + '.env', 'utf8'); }
catch { console.error('Falta .env (copia env.example a .env y rellénalo).'); process.exit(1); }

const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}

// Lo único que puede llegar al navegador. TURN_*, CF_*, TEST_* y secretos NUNCA van aquí.
// @step publish/env
const REQUIRED = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID',
  'NAME_DOMAIN', 'ADMIN_UIDS', 'SITE_HOSTS'];
const missing = REQUIRED.filter(k => !env[k]);
if (missing.length) { console.error('Faltan en .env: ' + missing.join(', ')); process.exit(1); }

const list = k => (env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
const url = k => (env[k] || '').replace(/\/+$/, '');
for (const k of ['GOOGLE_DESKTOP_CLIENT_ID', 'GOOGLE_TV_CLIENT_ID']) if (env[k] && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(env[k])) { console.error(k + ' con formato raro'); process.exit(1); }
for (const k of ['ICE_URL', 'LIVE_BASE']) if (env[k] && !/^https:\/\/[^\s/]+/.test(env[k])) { console.error(k + ' tiene que empezar por https://'); process.exit(1); }
const uids = list('ADMIN_UIDS');
if (uids.some(u => !/^[A-Za-z0-9]{20,40}$/.test(u))) { console.error('ADMIN_UIDS: uid con formato raro'); process.exit(1); }

// Actualizaciones firmadas (docs/updates.md): al juego sólo va la clave PÚBLICA, sacada de la privada (así no se desfasan).
// Sin UPDATE_SIGN_KEY (p. ej. un fork que no publica), el build sale sin autoactualización.
// @step publish/haskey decision "¿Hay UPDATE_SIGN_KEY?"
// Con clave Ed25519 saca su pública y arma update {author,key,urls} (UPDATE_URLS o LIVE_BASE/update/).
// @next envjs "sí: update {key,urls}"
// @next envjs "no: sin autoactualización"
let update = null;
const updateUrls = () => {
  const urls = (list('UPDATE_URLS').length ? list('UPDATE_URLS') : env.LIVE_BASE ? [url('LIVE_BASE') + '/update'] : []).map(u => u.replace(/\/*$/, '/'));
  if (!urls.length || urls.some(u => !/^https:\/\/[^\s/]+\/\S*$/.test(u))) { console.error('UPDATE_URLS (o LIVE_BASE): URLs https:// separadas por comas'); process.exit(1); }
  return urls;
};
// Sin la privada (la CI de las releases), basta la PÚBLICA: UPDATE_PUBLIC_KEY, la «key» de update en tu js/env.js.
if (!env.UPDATE_SIGN_KEY && env.UPDATE_PUBLIC_KEY) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.UPDATE_PUBLIC_KEY)) { console.error('UPDATE_PUBLIC_KEY: la clave pública Ed25519 en base64url (43 caracteres)'); process.exit(1); }
  update = { author: env.UPDATE_AUTHOR || '', key: env.UPDATE_PUBLIC_KEY, urls: updateUrls() };
}
if (env.UPDATE_SIGN_KEY) {
  let k;
  try { k = createPrivateKey({ key: Buffer.from(env.UPDATE_SIGN_KEY, 'base64'), format: 'der', type: 'pkcs8' }); } catch {}
  if (!k || k.asymmetricKeyType !== 'ed25519') { console.error('UPDATE_SIGN_KEY no es una clave Ed25519 PKCS8 en base64'); process.exit(1); }
  const urls = updateUrls();
  // @step publish/haskey
  update = { author: env.UPDATE_AUTHOR || '', key: createPublicKey(k).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url'), urls };
}

// La versión (VERSION) y el build (hash corto del commit; '' fuera de git): Ajustes → Acerca de, y la versión mínima para
// jugar online (G.Social.onlineOk, config/online en Firestore).
let build = '';
try { build = execSync('git rev-parse --short=8 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sin git */ }
const pub = {
  version: readFileSync(root + 'VERSION', 'utf8').trim(),
  build,
  firebase: Object.fromEntries(Object.entries({
    apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET, messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID, databaseURL: url('FIREBASE_DATABASE_URL')
  }).filter(([, v]) => v)),
  server: url('ICE_URL'),          // vacío: sin TURN, sello ni salas por WebSocket (el juego arranca igual)
  nameDomain: env.NAME_DOMAIN,
  hosts: list('SITE_HOSTS'),
  // (sin admins: sólo van a firestore.gen.rules; el juego pregunta a las reglas, Ranking.isAdmin)
  liveBase: url('LIVE_BASE'),      // vacío: sin aviso de directo / vídeo
  // Entrar con Google en el juego de escritorio (native/): cliente OAuth «App de escritorio» de Google Cloud. Su «secreto»
  // no lo es (Google lo da por público en las apps instaladas). Vacío: el botón de Google sale desactivado en escritorio.
  googleDesktop: env.GOOGLE_DESKTOP_CLIENT_ID ? { clientId: env.GOOGLE_DESKTOP_CLIENT_ID, clientSecret: env.GOOGLE_DESKTOP_CLIENT_SECRET || '' } : null,
  // En las consolas (PS5, Switch), sin navegador: cliente «TVs y dispositivos de entrada limitada» (QR + código). Igual de público.
  googleTV: env.GOOGLE_TV_CLIENT_ID ? { clientId: env.GOOGLE_TV_CLIENT_ID, clientSecret: env.GOOGLE_TV_CLIENT_SECRET || '' } : null,
  update   // { author, key, urls } o null: sin autoactualización
};
writeFileSync(root + 'BUILD', build + '\n');   // (los nombres de los paquetes: native/tools/package-*.sh, just ps5)
writeFileSync(root + 'js/env.js', '/* Generado por tools/apply-env.mjs desde .env. No editar ni subir a git. */\nwindow.PS_ENV = ' + JSON.stringify(pub) + ';\n');

const rules = readFileSync(root + 'firestore.rules', 'utf8');
if (!rules.includes('__ADMIN_UIDS__')) { console.error('firestore.rules sin __ADMIN_UIDS__'); process.exit(1); }
writeFileSync(root + 'firestore.gen.rules', rules.replace('__ADMIN_UIDS__', JSON.stringify(uids)));

console.log('ok: js/env.js y firestore.gen.rules (' + Object.keys(pub.firebase).length + ' campos de Firebase, '
  + uids.length + ' admin, ' + pub.hosts.length + ' dominio, servidor ' + (pub.server ? 'sí' : 'no') + ', Google ' + [pub.googleDesktop && 'escritorio', pub.googleTV && 'consolas'].filter(Boolean).join('+') + ', actualizaciones ' + (update ? 'sí' : 'no') + ')');
