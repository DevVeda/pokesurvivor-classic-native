// ¿Se ha colado algún secreto de .env? Busca el VALOR de cada variable secreta en git (todo el historial y lo que está
// sin subir), en dist/live (lo que sirve el Worker) y en lo que se reparte: native/build/dist, native/build/switch y el
// título de PS5 (../ps5gpu/poke-title/dist). Dentro de un .zip/.apk no mira (va comprimido): mira la carpeta de la que
// sale. Sólo imprime nombres de variables y de archivos, nunca valores. Antes de cada release: just leak-check
// Secretas: las que se llaman *TOKEN*, *PASSWORD*, *SIGN_KEY*, *PRIVATE*, *_KEY_ID. Las de env.example que van a
// js/env.js (Firebase, GOOGLE_*_CLIENT_*, dominios…) son públicas a propósito: van en cada build.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const env = {};
try {
  for (const line of readFileSync(process.env.ENV_FILE || root + '.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { console.error('Falta .env.'); process.exit(1); }
const secret = Object.entries(env).filter(([k, v]) => /TOKEN|PASSWORD|SIGN_KEY|PRIVATE|_KEY_ID/.test(k) && v.length >= 8);
if (!secret.length) { console.log('No hay variables secretas en .env.'); process.exit(0); }
console.log('Busco: ' + secret.map(([k]) => k).join(', '));

const hits = [];
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
for (const [k, v] of secret) {
  // (-S: los commits que añaden o quitan ese texto, en cualquier rama; y lo que hay ahora sin subir)
  // @step publish/leak
  const commits = git(['log', '--all', '--format=%h', '-S', v]).trim();
  if (commits) hits.push(`${k}: en el historial de git (commits ${commits.split('\n').join(', ')})`);
  try { git(['grep', '-lF', '-e', v]).trim().split('\n').filter(Boolean).forEach(f => hits.push(`${k}: en ${f} (git)`)); } catch {}
}
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
for (const d of ['dist/live', 'native/build/dist', 'native/build/switch', '../ps5gpu/poke-title/dist'].filter(d => existsSync(root + d))) {
  for (const f of walk(root + d)) {
    if (statSync(f).size > 512 << 20) continue;
    const buf = readFileSync(f);
    for (const [k, v] of secret) if (buf.includes(v)) hits.push(`${k}: en ${f.slice(root.length)}`);
  }
}
if (hits.length) { console.log('\nOJO, encontrado:\n  ' + hits.join('\n  ')); process.exit(1); }
console.log('Ningún secreto de .env en git, dist/live ni en los paquetes.');
