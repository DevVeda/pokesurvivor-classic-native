#!/usr/bin/env node
// js/app.js: las fuentes de js/<área>/ juntas, en el orden de js/files.js, para la web (una petición; su huella es la
// versión que mira G.Updater). Se genera, no está en git: lo hacen `just web` (tools/build-web.mjs) y `just web-local`.
// Los puertos nativos no lo usan: cargan las fuentes sueltas (native/shim/boot.js).
//   node tools/app-js.mjs
// En app.js los `@step`/`@flow` van como `@~step`/`@~flow`: flowdoc lee las fuentes y no ve los pasos dos veces.
// @step publish/appjs build "js/<área>/ → js/app.js"
// Las fuentes del juego (js/core, data, game, systems, online, menu) se juntan en el orden de js/files.js.
// @next webhost "just web"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'js/app.js';

export function build() {
  const files = {};
  runInNewContext(readFileSync(join(root, 'js/files.js'), 'utf8'), files);
  const missing = files.PS_FILES.filter(f => !existsSync(join(root, f)));
  if (missing.length) throw new Error('app-js: faltan ' + missing.join(', '));
  writeFileSync(join(root, OUT), files.PS_FILES.map(f => {
    const c = readFileSync(join(root, f), 'utf8').replace(/@(step|flow)\b/g, '@~$1');
    return `/* ${f} */\n` + (c.endsWith('\n') ? c : c + '\n');
  }).join(''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { build(); console.log('app-js: ' + OUT); } catch (e) { console.error(e.message); process.exit(1); }
}
