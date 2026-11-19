/* ============ gifts.js — regalos y quitas del admin (31-10-2026) ============
 * Desde Moderación (la pantalla de la web vieja; rama main-web): buscar una cuenta por nombre, darle o quitarle monedas, tickets y Pokémon.
 * Va en una transacción sobre su partida de la nube (saves/{uid}), por la libreta (led.admin: [dado, quitado]),
 * así la fusión de sus aparatos no lo deshace. Lo quitado queda en rvk (db.js) para que no vuelva de otra copia.
 */
G.Gifts = (() => {
  const fs = () => G.DB.fb.fs;
  const ref = uid => fs().collection('saves').doc(uid);
  const n = v => Math.max(0, Math.min(1e9, Math.floor(+v || 0)));
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  /** La cuenta con ese nombre: lo que tiene (o none si aún no tiene partida en la nube), o null. */
  // @step mod/acc net "Buscar cuenta"
  // names/{apodo} → saves/{uid}: monedas, tickets, owned, shiny, ban.
  // @next gift
  async function find(name) {
    const nm = await fs().collection('names').doc(String(name).trim().toLowerCase()).get();
    if (!nm.exists) return null;
    const uid = nm.data().uid, d = await ref(uid).get();
    if (!d.exists) return { uid, name, none: true };
    const s = d.data().save || {};
    return { uid, name: s.name || name, coins: s.coins || 0, t1: (s.tickets || {}).t1 || 0, t10: (s.tickets || {}).t10 || 0,
      owned: Object.keys(s.owned || {}).length, shiny: Object.keys(s.shiny || {}).length, ban: !!d.data().ban };
  }

  /** Lo de ahora (monedas y tickets) y la libreta, con lo de antes de la libreta en base. */
  function ledger(s) {
    s.tickets = isObj(s.tickets) ? s.tickets : {};
    const cur = { c: n(s.coins), t1: n(s.tickets.t1), t10: n(s.tickets.t10) };
    if (!isObj(s.led)) {
      s.led = { base: {} };
      for (const k in cur) s.led.base[k] = [cur[k], 0];
    }
    return cur;
  }

  /** Da { coins, t1, t10, mons: { dex: shiny } }. */
  // @step mod/gift net "Dar / quitar"
  // Transacción sobre saves/{uid}: led.admin, rvk para quitar Pokémon, rev+1 (la siguiente subida del
  // jugador fusiona).
  function give(uid, g) {
    return fs().runTransaction(async tx => {
      const r = ref(uid), d = await tx.get(r);
      if (!d.exists) throw { code: 'sin-partida' };
      const doc = d.data(), s = doc.save || {};
      const cur = ledger(s);
      const adm = s.led.admin = isObj(s.led.admin) ? s.led.admin : {};
      for (const [k, v] of [['c', n(g.coins)], ['t1', n(g.t1)], ['t10', n(g.t10)]]) {
        if (!v) continue;
        const e = Array.isArray(adm[k]) ? adm[k] : [0, 0];
        adm[k] = [n(e[0]) + v, n(e[1])];
        cur[k] += v;
      }
      s.coins = cur.c; s.tickets.t1 = cur.t1; s.tickets.t10 = cur.t10;
      s.owned = isObj(s.owned) ? s.owned : {};
      s.shiny = isObj(s.shiny) ? s.shiny : {};
      for (const [dex, shiny] of Object.entries(g.mons || {})) {
        if (!G.DEX_BY[dex]) continue;
        if (!s.owned[dex]) s.owned[dex] = { at: Date.now(), from: 'gift' };
        if (shiny && !s.shiny[dex]) s.shiny[dex] = { at: Date.now(), from: 'gift' };
      }
      tx.update(r, { save: s, rev: (+doc.rev || 0) + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  }

  /** Quita { coins, t1, t10, mons: { dex: sóloShiny } } (como mucho lo que tenga). */
  // @step mod/gift
  function take(uid, g) {
    return fs().runTransaction(async tx => {
      const r = ref(uid), d = await tx.get(r);
      if (!d.exists) throw { code: 'sin-partida' };
      const doc = d.data(), s = doc.save || {};
      const cur = ledger(s);
      const adm = s.led.admin = isObj(s.led.admin) ? s.led.admin : {};
      for (const [k, v] of [['c', n(g.coins)], ['t1', n(g.t1)], ['t10', n(g.t10)]]) {
        const x = Math.min(v, cur[k]);
        if (!x) continue;
        const e = Array.isArray(adm[k]) ? adm[k] : [0, 0];
        adm[k] = [n(e[0]), n(e[1]) + x];
        cur[k] -= x;
      }
      s.coins = cur.c; s.tickets.t1 = cur.t1; s.tickets.t10 = cur.t10;
      s.owned = isObj(s.owned) ? s.owned : {};
      s.shiny = isObj(s.shiny) ? s.shiny : {};
      s.rvk = isObj(s.rvk) ? s.rvk : {};
      const now = Date.now();
      for (const [dex, onlyShiny] of Object.entries(g.mons || {})) {
        for (const coll of onlyShiny ? ['shiny'] : ['owned', 'shiny']) {
          if (!s[coll][dex]) continue;
          delete s[coll][dex];
          (s.rvk[coll] = isObj(s.rvk[coll]) ? s.rvk[coll] : {})[dex] = now;
        }
      }
      if (s.partner != null && !s.owned[s.partner]) s.partner = s.owned[s.starter] ? s.starter : (+Object.keys(s.owned)[0] || s.partner);
      if (s.partnerShiny && !s.shiny[s.partner]) s.partnerShiny = false;
      tx.update(r, { save: s, rev: (+doc.rev || 0) + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  }

  return { find, give, take };
})();

;
