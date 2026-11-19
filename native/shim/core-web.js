/* core-web.js — la web con el núcleo de la partida en C (core/, compilado a WebAssembly: shim/core.wasm, core_wasm.c), como
 * las demás versiones: pone ps.core_* (lo mismo que core_js.c) y carga shim/core.js. Si el WASM no carga, la web sigue
 * con la partida en JS, como antes.
 * Orden en index.html: después de js/app.js (core.js necesita G); core.wasm y core.js llevan la ?v= de este archivo.
 * El arnés (run-node.cjs, PS_CORE=wasm) usa psCoreWasm con el mismo core.wasm.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  // Los ps.core_* sobre la instancia del WASM (exports de core_wasm.c).
  globalThis.psCoreWasm = (ex, ps) => {
    // (los textos son ids de ataques y habilidades: ASCII; sin TextEncoder, que QuickJS y el arnés no traen)
    const str = s => {   // (texto → cw_buf, acabado en 0)
      const t = String(s == null ? '' : s).slice(0, 1000), m = new Uint8Array(ex.memory.buffer, ex.cw_buf(), t.length + 1);
      for (let i = 0; i < t.length; i++) m[i] = t.charCodeAt(i) & 0x7f;
      m[t.length] = 0;
    };
    const cstr = p => { const m = new Uint8Array(ex.memory.buffer); let s = ''; while (m[p]) s += String.fromCharCode(m[p++]); return s; };
    const list = n => ex.memory.buffer.slice(ex.cw_out(), ex.cw_out() + n * 8);   // (una copia: como JS_NewArrayBufferCopy)
    const pad = (a, n) => { const r = Array.from(a, Number); while (r.length < n) r.push(0); return r; };
    const plain = ['core_reset', 'core_player', 'core_input', 'core_view', 'core_active', 'core_item', 'core_drop', 'core_ppos',
                   'core_php', 'core_god', 'core_eset', 'core_stash', 'core_restore', 'core_clear', 'core_pullall', 'core_arena',
                   'core_mode', 'core_biome', 'core_weather', 'core_step'];
    for (const k of plain) ps[k] = (...a) => ex[k](...a.map(Number));
    Object.assign(ps, {
      core_enemy: (...a) => ex.core_enemy(...pad(a, 19)),
      core_hazard: (...a) => ex.core_hazard(...pad(a, 13)),
      core_stats: (...a) => ex.core_stats(...pad(a, 11), a.length),
      core_orb: (...a) => !!ex.core_orb(...a.map(Number)),
      core_free: (x, y, r) => !!ex.core_free(x, y, r),
      core_learn: (i, id, lv, evo) => { str(id); return !!ex.core_learn(i, lv, evo ? 1 : 0); },
      core_movelvl: (i, id, lv, evo) => { str(id); return !!ex.core_movelvl(i, lv, evo ? 1 : 0); },
      core_ability: (i, id, type) => { str(id); ex.core_ability(i, type); },
      core_slots: (i, s, active) => { str(s); return !!ex.core_slots(i, active); },
      core_dealt: i => {
        const n = ex.core_dealt(i), b = new Float64Array(list(n * 2)), o = {};
        for (let k = 0; k < n; k++) { const id = cstr(ex.cw_move_id(b[k * 2])); o[id] = (o[id] || 0) + b[k * 2 + 1]; }
        return o;
      },
      core_events: () => list(ex.core_events()),
      core_state: () => list(ex.core_state()),
      core_props: (x, y, r) => list(ex.core_props(x, y, r)),
    });
    ['CORE_PL', 'CORE_EN', 'CORE_PR', 'CORE_FI', 'CORE_PU', 'CORE_HZ'].forEach((k, i) => { ps[k] = ex.cw_const(i); });
  };

  if (typeof document === 'undefined' || !globalThis.ps || ps.PLATFORM !== 'web') return;
  const me = document.currentScript, v = me && /\?v=\w+/.exec(me.src), q = v ? v[0] : '';
  const base = me ? me.src.replace(/core-web\.js.*$/, '') : 'native/shim/';
  const imports = { env: { emscripten_notify_memory_growth: () => {} } };
  // (sin instantiateStreaming: no depende de que el servidor mande application/wasm)
  fetch(base + 'core.wasm' + q).then(r => { if (!r.ok) throw new Error('core.wasm: ' + r.status); return r.arrayBuffer(); })
    .then(b => WebAssembly.instantiate(b, imports))
    .then(({ instance }) => {
      const ex = instance.exports;
      if (ex._initialize) ex._initialize();
      psCoreWasm(ex, ps);
      const s = document.createElement('script');
      s.src = base + 'core.js' + q;
      s.onload = () => console.log('[web] núcleo en C (WebAssembly) en marcha');
      document.body.appendChild(s);
    })
    .catch(e => console.error('[web] sin el núcleo en C (la partida, en JS): ' + e.message));
})();
