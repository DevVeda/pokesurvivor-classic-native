// The saves in this browser: ps.save.<local account> and ps.cloud.<uid> (the cloud copy), newest first.
// They are signed ("_h" at the end): the signature is dropped; the desktop game signs again when it saves.
function psSaves() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/^ps\.(save|cloud)\./.test(k)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s && typeof s === 'object' && s.owned && typeof s.owned === 'object') { delete s._h; out.push(s); }
    } catch (e) { /* not a save */ }
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
// Asks about each save (newest first) until the player says yes. null if there is none or they decline all.
function psPick(verb) {
  const list = psSaves();
  if (!list.length) { alert('PokéSurvivor: there is no save in this browser. Log in on pokesurvivor.com, wait for it to load and try again.'); return null; }
  return list.find(s => confirm('PokéSurvivor: ' + verb + ' the save of "' + (s.name || '?') + '" (' +
    Object.keys(s.owned).length + ' Pokémon, ' + new Date(s.updated || 0).toLocaleString() + ')?')) || null;
}
