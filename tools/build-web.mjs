#!/usr/bin/env node
// Web: pone las huellas (?v=) en index.html, escribe version.json y monta dist/web para Cloudflare Pages (just web).
//   node tools/build-web.mjs           huellas + dist/web
//   node tools/build-web.mjs --force   además version.json con force:true (versión obligatoria: corta las partidas)
// version.json.v = huella de js/app.js?v= → G.Updater (js/app.js) la compara cada 5 min y recarga a los jugadores.
// @step publish/webhost
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildApp } from './app-js.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => readFileSync(join(root, p));
const hash = (...bufs) => { const h = createHash('sha1'); for (const b of bufs) h.update(b); return h.digest('hex').slice(0, 10); };

try { buildApp(); } catch (e) { console.error(e.message); process.exit(1); }   // js/app.js desde js/<área>/ (no está en git)
// El núcleo en C de la web (native/shim/core.wasm, just core-wasm): el sello son las fuentes con que se compiló.
const coreSrc = () => hash(rd('native/core_wasm.c'), ...readdirSync(join(root, 'native/core')).filter(f => /\.[ch]$/.test(f)).sort().map(f => rd('native/core/' + f)));
if (process.argv.includes('--wasm-stamp')) { writeFileSync(join(root, 'native/shim/core.wasm.src'), coreSrc() + '\n'); process.exit(0); }
if (!existsSync(join(root, 'native/shim/core.wasm.src')) || rd('native/shim/core.wasm.src').toString().trim() !== coreSrc()) {
  console.error('build-web: native/shim/core.wasm no es el de native/core/ de ahora (just core-wasm)'); process.exit(1);
}
if (!existsSync(join(root, 'js/env.js'))) { console.error('build-web: falta js/env.js (node tools/apply-env.mjs)'); process.exit(1); }

// Huellas: css; locales con los idiomas (locales.js pasa su ?v= a js/lang/*.js); app.js con todo lo que cambia la versión.
const langs = readdirSync(join(root, 'js/lang')).sort().map(f => rd('js/lang/' + f));
const vCss = hash(rd('css/style.css'));
const vLoc = hash(rd('js/core/locales.js'), ...langs);
let html = rd('index.html').toString();
const strip = s => s.replace(/\?v=[0-9a-f]+/g, '');
// @step updater/init
// (native/shim: las pantallas de las demás versiones, que la web usa en vez de su interfaz HTML: web.js, qr.js, ui.js)
const SHIM = ['native/shim/web.js', 'native/shim/qr.js', 'native/shim/ui.js', 'native/shim/core-web.js'];
// (los que carga core-web.js con su misma ?v=: el núcleo en C compilado a WebAssembly —just core-wasm— y core.js)
const LAZY = ['native/shim/core.wasm', 'native/shim/core.js'];
const vApp = hash(rd('js/app.js'), rd('js/boot.js'), rd('js/env.js'), ...SHIM.map(rd), ...LAZY.map(rd), Buffer.from(strip(html)), vCss, vLoc);

const set = (file, v) => {
  const re = new RegExp(`(${file.replace(/[.]/g, '\\.')})\\?v=[0-9a-f]+`);
  if (!re.test(html)) { console.error(`build-web: index.html no carga ${file}?v=`); process.exit(1); }
  html = html.replace(re, `$1?v=${v}`);
};
set('css/style.css', vCss); set('js/core/locales.js', vLoc); set('js/app.js', vApp);
for (const f of SHIM) set(f, vApp);
writeFileSync(join(root, 'index.html'), html);

const ver = { v: vApp, at: new Date().toISOString() };
if (process.argv.includes('--force')) ver.force = true;
const old = JSON.parse(rd('version.json'));
if (old.v === vApp && !ver.force) ver.at = old.at;            // nada cambió: no se toca (así no sale en git)
writeFileSync(join(root, 'version.json'), JSON.stringify(ver) + '\n');

// dist/web: sólo lo que sirve la web (de native/ sólo SHIM; nada de tools/, docs/, .env…). js/env.js sí: valores públicos.
const out = join(root, 'dist/web');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
// @step publish/webhost
// (las licencias van con la web: la del juego con su Required Notice, los créditos de los sprites y la del motor, cuyos
// shims se sirven; PolyForm Noncommercial y la GPL piden que quien recibe el código reciba también su licencia)
const FILES = ['index.html', '404.html', 'favicon.ico', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'sw.js', 'version.json', 'news.json', 'VERSION',
               'LICENSE', 'LICENSE-NONCOMMERCIAL.md', 'CREDITS.md'];
const DIRS = ['assets', 'css', 'js', 'apoyar', 'contacto', 'en', 'guia', 'legendarios', 'logros', 'movimientos', 'novedades', 'objetos', 'pokedex', 'privacidad', 'shinies', 'tipos'];
for (const f of [...FILES, ...DIRS]) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true });
for (const f of [...SHIM, ...LAZY, 'native/LICENSE', 'native/NOTICE.md', 'native/LICENSE-EXCEPTION.md']) cpSync(join(root, f), join(out, f));   // (sólo esos de native/)
// La web entra con Google por la ventana de Firebase: los clientes OAuth de escritorio y consolas no le hacen falta.
// ponytail: sólo la web; los nativos llevan los dos porque la actualización (sign-update.mjs) es la misma para todos.
const envOut = join(out, 'js/env.js');
writeFileSync(envOut, rd('js/env.js').toString().replace(/"google(Desktop|TV)":\{[^}]*\}/g, '"google$1":null'));
if (/googleusercontent/.test(rd('js/env.js').toString()) && /googleusercontent/.test(readFileSync(envOut, 'utf8'))) { console.error('build-web: Google nativo sigue en dist/web/js/env.js'); process.exit(1); }
// version.json siempre fresco (Pages cachea por defecto)
// @step publish/webupd event "Jugadores web"
// Cada navegador ve el version.json nuevo (no-cache por _headers) y G.Updater recarga fuera de partida
// tras 5 s, subiendo antes la partida.
// @sub updater
writeFileSync(join(out, '_headers'), '/version.json\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n');

console.log(`web ${ver.v}${ver.force ? ' (OBLIGATORIA)' : ''}${old.v === vApp ? ' (sin cambios)' : ` (antes ${old.v})`} → dist/web`);
