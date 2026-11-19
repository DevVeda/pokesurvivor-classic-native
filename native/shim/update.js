/* update.js — actualizaciones firmadas (docs/updates.md, «Cliente (nativo)»). Lo pesado (bajar, hashes, escribir) en C
 * (update.c); aquí: la firma, qué bajar y cuándo aplicarlo.
 *  - La clave y las URLs, de PS_ENV_DEFAULT.update: el env.js del binario o el de la versión instalada (firmada). Nunca del
 *    perfil de servidor del jugador (ps.server): eso no cambia quién firma.
 *  - Escritorio (ps.NATIVE): si el binario del manifiesto (native[id]) no es el que corre, se baja con el código a
 *    <huella>/native/<seq>/ y, al reabrir, el instalado le pasa el control (update.c). Nunca se toca la carpeta instalada.
 *  - En partida no se toca nada. En el menú: escritorio, aviso de 5 s y se reabre (ps.relaunch: los hilos del suelo
 *    también cargan el JS nuevo); PS5 y Switch, aviso y se aplica al volver a abrir el juego.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// @step nupdate/jsinit event "update.js: clave y URLs"
// PS_ENV_DEFAULT.update (nunca ps.server); sin clave o UPD_BASE sale. A los 10 s y cada 5 min.
// @next manifest
(() => {
  const U = (globalThis.PS_ENV_DEFAULT || {}).update;
  if (!ps.upd_get || !U || !U.key || !Array.isArray(U.urls) || !U.urls.length) { console.log('[update] sin actualizaciones (ni clave ni URLs en env.js)'); return; }
  // @step nupdate/jsinit
  if (!ps.UPD_BASE) return;   // sin update.seq (just run: los archivos del repo; update.c ya lo dice en el log)
  const PATH = /^[\w.-]+(\/[\w.-]+)*$/;
  const okPath = p => PATH.test(p) && !p.split('/').some(s => s === '.' || s === '..');
  const hex = b64 => [...atob(b64)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const keyBytes = Uint8Array.from(atob(U.key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - U.key.length % 4) % 4)), c => c.charCodeAt(0)).buffer;
  const FP = hex(ps.sha512(keyBytes)).slice(0, 16);   // la huella (como sign-update.mjs): una caché por autor
  const DIR = ps.DATA + '/update/' + FP;
  const [aFp, aSeq] = (ps.UPD_ACTIVE || '/').split('/');
  let have = Math.max(aFp === FP ? +aSeq : 0, ps.UPD_BASE), ready = null, checking = false, booted = false;

  // Una operación de update.c a la vez; se espera mirando ps.upd_poll.
  const run = startIt => new Promise((ok, ko) => {
    if (!startIt()) return ko(new Error('ocupado o no válido'));
    const t = setInterval(() => { const r = ps.upd_poll(); if (!r || r.run) return; clearInterval(t); r.ok ? ok(r) : ko(new Error(r.err)); }, 100);
  });
  const get = (url, max) => run(() => ps.upd_get(url, max));

  // El primer servidor que dé un version.json bien firmado por nuestra clave.
  // @step updater/native event "Actualizador nativo"
  // En los ports nativos esto baja e instala; cuándo aplicarlo, G.Updater (js/core/updater.js).
  // @sub nupdate
  // @step publish/nclients event "Clientes nativos"
  // Cada binario consulta el manifiesto firmado e instala lo nuevo.
  // @sub nupdate
  // @step nupdate/manifest net "Bajar y verificar"
  // version.json + .sig; ed25519_ok (Monocypher) con la clave fijada.
  // @next gate "firma ok"
  async function manifest() {
    for (const base of U.urls) {
      try {
        const body = await get(base + 'version.json', 1 << 20), sig = (await get(base + 'version.json.sig', 1024)).text.trim();
        // @step nupdate/manifest
        if (!ps.ed25519_ok(U.key, body.data, sig)) { console.warn('[update] ' + base + ': la firma no es de esta clave: se ignora'); continue; }
        const m = JSON.parse(body.text);
        if (m.key !== U.key) { console.warn('[update] ' + base + ': manifiesto de otra clave'); continue; }
        return { m, base };
      } catch (e) { console.warn('[update] ' + base + ': ' + e.message); }
    }
    return null;
  }

  async function check() {
    if (checking || ready) return;
    checking = true;
    try {
      const got = await manifest();
      if (!got) return;
      const { m, base } = got, seq = +m.seq;
      if (!(seq > have) || FP + '/' + seq === ps.UPD_BAD) return;
      // El binario: el de native[id], si alguno de sus archivos no es como el del programa que corre.
      const N = ps.upd_native && ps.NATIVE, nat = N && m.native && m.native[N.id];
      const natFiles = nat ? Object.entries(nat.files || {}) : [];
      if (nat && (!natFiles.length || natFiles.some(([p, f]) => !okPath(p) || !(f.size >= 0)) || !nat.files[N.exe])) throw new Error('rutas no válidas en native.' + N.id);
      // @step nupdate/natbin decision "¿Binario distinto?"
      // Escritorio: native[id] distinto → se baja y upd_native lo apunta.
      // @next activate
      const natNew = natFiles.some(([p, f]) => !ps.upd_same(N.prog + '/' + p, f.sha512, f.size));
      // @step nupdate/gate decision "¿seq y minNative?"
      // seq mayor y no bad; minNative ≤ UPD_API (o el binario nuevo lo cumple).
      // @next install "sí"
      if (!(m.minNative <= ps.UPD_API) && !(natNew && m.minNative <= nat.api)) { console.log('[update] ' + m.version + ' (' + m.build + ') pide un juego más nuevo (minNative ' + m.minNative + '): descárgalo'); return; }
      const files = Object.entries(m.files || {});
      if (!files.length || files.some(([p, f]) => !okPath(p) || !/^(shim|game)\//.test(p) || !(f.size >= 0))) throw new Error('rutas no válidas en version.json');
      const dest = DIR + '/' + seq, prev = aFp === FP && +aSeq === have ? DIR + '/' + have : null;
      // El código: de la versión de ahora (o del binario) lo que no cambió; lo demás, bajado.
      const jobs = files.map(([p, f]) => [base + p, dest + '/' + p, f.sha512, f.size, (prev || ps.ROOT) + '/' + p, false]);
      // Los assets: sólo si cambió packs.json; de cada uno, el del binario si es igual (y sobra el instalado); si no, su
      // trozo del pack (update.c baja cada pack una vez: sign-update.mjs escribe los de un mismo pack seguidos).
      const ASHA = DIR + '/packs.sha512';
      let assetsSha = null;
      // (un binario de antes, UPD_API 1, no sabe cortar packs: sin assets nuevos hasta que se actualice el binario)
      if (m.packs && ps.UPD_API >= 2 && m.packs.sha512 !== String(ps.readFile(ASHA) || '').trim()) {
        const r = await get(base + 'packs.json', Math.min(m.packs.size, 64 << 20));
        if (r.data.byteLength !== m.packs.size || ps.sha512(r.data) !== m.packs.sha512) throw new Error('packs.json no coincide con su hash');
        const P = JSON.parse(r.text), packs = P.packs || {}, a = Object.entries(P.files || {});
        const PACK = /^packs\/[0-9a-f]{16}\.bin$/;
        if (a.some(([p, f]) => !okPath(p) || !p.startsWith('game/assets/') || !(f.size >= 0) || !PACK.test(f.pack) || !(f.off >= 0)
          || !(f.off + f.size <= packs[f.pack]))) throw new Error('rutas o packs no válidos en packs.json');
        for (const [p, f] of a) jobs.push([base + f.pack, DIR + '/assets/' + p, f.sha512, f.size, ps.ROOT + '/' + p, true, f.off, packs[f.pack]]);
        assetsSha = m.packs.sha512;
      }
      // (los archivos del binario que no cambian, copiados del que corre)
      if (natNew) for (const [p, f] of natFiles) jobs.push([base + 'native/' + N.id + '/' + p, DIR + '/native/' + seq + '/' + N.sub + p, f.sha512, f.size, N.prog + '/' + p, false]);
      console.log('[update] ' + m.version + ' build ' + m.build + ' (seq ' + seq + ', ' + (m.author || 'sin autor') + '): ' + jobs.length + ' archivos que comprobar');
      const t0 = ps.now();
      // @step nupdate/install net "upd_install en hilo"
      // Hilo C con curl: baja lo distinto con tamaño y SHA-512; assets desde packs.
      // @next natbin
      await run(() => ps.upd_install(jobs));
      if (assetsSha) ps.writeFile(ASHA, assetsSha);
      // @step nupdate/activate data "Activar y podar"
      // upd_activate escribe active; upd_prune deja la nueva y la anterior.
      // @next menu
      if (!ps.upd_activate(FP + '/' + seq)) throw new Error('no se pudo activar');
      if (natNew) {
        if (!ps.upd_native(FP + '/' + seq)) throw new Error('no se pudo activar el binario');
        // @step nupdate/activate
        ps.upd_prune(DIR + '/native', String(seq), N.seq ? String(N.seq) : '');   // (el que corre, también: en Windows no se puede borrar)
        console.log('[update] binario nuevo (' + N.id + '): se abre al reiniciar');
      }
      ps.upd_prune(DIR, String(seq), prev ? String(have) : '');
      console.log('[update] instalada en ' + Math.round(ps.now() - t0) + ' ms: se aplica en el menú');
      have = seq;
      ready = m;
      // @step nupdate/menu decision "Aplicar en el menú"
      // G.Updater.offer (js/core/updater.js, como la web): en el menú, sube lo pendiente, aviso 5 s y ps.relaunch
      // (escritorio/Android); PS5/Switch: se aplica al reabrir.
      // @next relaunch "escritorio/Android"
      G.Updater.offer({ forced: !!m.force, apply: ps.CAN.relaunch ? () => { console.log('[update] se reabre con la versión nueva'); ps.relaunch(); } : null });
    } catch (e) { console.warn('[update] ' + e.message); }
    finally { checking = false; }
  }

  // En el menú (sin pantallas encima ni escribiendo) el arranque ha ido bien: anti-bucle (upd_booted). Cuándo se aplica la
  // instalada lo decide G.Updater (js/core/updater.js, como en la web: en el menú, nunca en partida, subiendo antes lo
  // pendiente a la nube): reabriendo (ps.relaunch) donde se puede; si no (PS5, Switch), al volver a abrir el juego.
  setInterval(() => {
    if (!booted && globalThis.psAtMenu && psAtMenu() && !globalThis.psTextSink) { booted = true; ps.upd_booted(); }
  }, 500);

  // @step nupdate/jsinit
  setTimeout(check, 10000);   // (que el arranque vaya primero)
  setInterval(check, 5 * 60 * 1000);
  globalThis.psUpdateCheck = check;   // (diagnóstico: PS_EVAL_AT)
})();
