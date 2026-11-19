// Prueba las reglas (firestore.rules, database.rules.json) contra los emuladores.
// npx firebase-tools emulators:exec --only firestore,database --project demo-ps "node tools/rules-test.mjs"
const P = 'demo-ps', FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const RT = 'http://127.0.0.1:9000', NS = '?ns=demo-ps-default-rtdb';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = uid => b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ sub: uid, user_id: uid, aud: P, iss: 'https://securetoken.google.com/' + P, iat: 1, exp: 9e9, firebase: { sign_in_provider: 'password' } }) + '.';

const v = x => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x }
  : Number.isInteger(x) ? { integerValue: String(x) } : Array.isArray(x) ? { arrayValue: { values: x.map(v) } }
  : x === null ? { nullValue: null } : x instanceof Date ? { timestampValue: x.toISOString() } : { mapValue: { fields: f(x) } };
const f = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, v(x)]));

// Escribe docs (con updatedAt/at = hora del servidor si se pide) en una sola transacción.
async function commit(uid, docs) {
  const writes = docs.map(([path, data, ts = [], pre]) => Object.assign({
    update: { name: `projects/${P}/databases/(default)/documents/${path}`, fields: f(data) },
    updateTransforms: ts.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }))
  }, pre ? { currentDocument: pre } : {}));
  const r = await fetch(FS + ':commit', { method: 'POST', headers: { Authorization: 'Bearer ' + (uid ? tok(uid) : 'owner'), 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
  return r.ok;
}
const get = async (uid, path) => (await fetch(`${FS}/${path}`, { headers: uid ? { Authorization: 'Bearer ' + tok(uid) } : {} })).status;
const rt = async (uid, path, method, body) => (await fetch(`${RT}/${path}.json${NS}&auth=${tok(uid)}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })).ok;

let fails = 0;
const check = (name, got, want) => { const ok = got === want; if (!ok) fails++; console.log((ok ? 'ok   ' : 'FALLA') + ' ' + name); };

// --- partida guardada
check('crear mi partida (rev 1)', await commit('ana', [['saves/ana', { save: { coins: 1 }, v: 'x', rev: 1 }, ['updatedAt']]]), true);
check('leer partida ajena', await get('bob', 'saves/ana'), 403);
check('subir otra vez antes de 20 s', await commit('ana', [['saves/ana', { save: {}, v: 'x', rev: 2 }, ['updatedAt']]]), false);
await commit(null, [['saves/ana', { save: {}, v: 'x', rev: 1, updatedAt: { stamp: 0 } }]]);   // admin: updatedAt viejo
await fetch(`${FS}/saves/ana?updateMask.fieldPaths=updatedAt`, { method: 'PATCH', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { updatedAt: { timestampValue: '2020-01-01T00:00:00Z' } } }) });
check('rev que no sigue (3 tras 1)', await commit('ana', [['saves/ana', { save: {}, v: 'x', rev: 3 }, ['updatedAt']]]), false);
check('ponerse ban a mano', await commit('ana', [['saves/ana', { save: {}, v: 'x', rev: 2, ban: true }, ['updatedAt']]]), false);
check('subida buena (rev 2)', await commit('ana', [['saves/ana', { save: {}, v: 'x', rev: 2 }, ['updatedAt']]]), true);

// --- apodos
check('reservar apodo', await commit('ana', [['names/ana_99', { uid: 'ana' }, [], { exists: false }]]), true);
check('quitar apodo ajeno', await commit('bob', [['names/ana_99', { uid: 'bob' }]]), false);

// --- ranking
const entry = { uids: ['ana'], names: ['Ana'], dex: [25], shiny: [false], t: 600, rt: 600, lv: 40, kills: 2000, dmg: 0 };
check('marca buena', await commit('ana', [['lb/s_x/e/ana', entry, ['at']]]), true);
check('marca imposible (nivel 999)', await commit('ana', [['lb/s_x/e/ana', { ...entry, lv: 999 }, ['at']]]), false);
check('marca a nombre de otro', await commit('bob', [['lb/s_x/e/ana', entry, ['at']]]), false);
check('resumen con mi marca en la misma transacción', await commit('ana', [['lb/s_y/e/ana', entry, ['at']], ['lbs/s_y', { top: { ana: { t: 600 } }, me: 'ana', ev: '' }]]), true);
check('resumen que mete una marca ajena', await commit('bob', [['lbs/s_y', { top: { ana: { t: 9e3 } }, me: 'ana', ev: '' }]]), false);
check('leer ranking sin cuenta', await get(null, 'lbs/s_y'), 200);
check('leer una marca sin cuenta', await get(null, 'lb/s_y/e/ana'), 200);
check('listar marcas sin cuenta', await get(null, 'lb/s_y/e'), 403);
check('listar marcas con cuenta', await get('bob', 'lb/s_y/e'), 200);
check('listar todas las tablas (no admin)', await get('bob', 'lbs'), 403);
check('listar apodos', await get('bob', 'names'), 403);
check('leer un apodo', await get('bob', 'names/ana_99'), 200);
check('listar perfiles', await get('bob', 'profiles'), 403);

// --- invitaciones y reportes con exp (política TTL)
const inv = { to: 'bob', from: 'ana', room: 'ana', name: 'Ana' }, day = 864e5;
check('invitación con exp a 1 día', await commit('ana', [['inv/bob_ana', { ...inv, exp: new Date(Date.now() + day) }, ['at']]]), true);
check('invitación con exp a 1 año', await commit('ana', [['inv/bob_ana', { ...inv, exp: new Date(Date.now() + 365 * day) }, ['at']]]), false);
check('invitación sin exp (versión vieja)', await commit('ana', [['inv/bob_ana', inv, ['at']]]), true);
const rep = { board: 's_y', e: 'ana', names: ['Ana'], t: 600, by: 'bob', at: 1 };
check('reporte con exp a 30 días', await commit('bob', [['reports/s_y__ana__bob', { ...rep, exp: new Date(Date.now() + 30 * day) }]]), true);
check('reporte con exp como texto', await commit('bob', [['reports/s_y__ana__bob', { ...rep, exp: 'nunca' }]]), false);

// --- salas (Realtime Database)
check('crear mi sala', await rt('ana', 'rooms/ana', 'PUT', { host: 'ana', open: true, at: 1, m: { ana: { name: 'Ana' } } }), true);
check('entrar en sala ajena', await rt('bob', 'rooms/ana/m/bob', 'PUT', { name: 'Bob' }), true);
check('cerrar sala ajena', await rt('bob', 'rooms/ana/open', 'PUT', false), false);
check('mensaje en mi hueco', await rt('bob', 'rooms/ana/q/ana/bob_00', 'PUT', '{"x":1}'), true);
check('mensaje en hueco de otro', await rt('bob', 'rooms/ana/q/ana/ana_00', 'PUT', '{"x":1}'), false);
check('mensaje a quien no está en la sala', await rt('bob', 'rooms/ana/q/zzz/bob_00', 'PUT', '{"x":1}'), false);
check('anfitrión escribe a un miembro', await rt('ana', 'rooms/ana/q/bob/ana_00', 'PUT', '{"x":1}'), true);
check('miembro con todo lo del juego', await rt('bob', 'rooms/ana/m/bob', 'PUT', { name: 'Bob', dex: 25, shiny: false, at: 1 }), true);
check('cambiar compañero (update)', await rt('bob', 'rooms/ana/m/bob', 'PATCH', { dex: 4, shiny: true }), true);
check('miembro con basura extra', await rt('bob', 'rooms/ana/m/bob', 'PUT', { name: 'Bob', junk: 'x'.repeat(5000) }), false);
check('anfitrión mete basura en su sala', await rt('ana', 'rooms/ana/junk', 'PUT', 'x'.repeat(5000)), false);
check('rehacer sala como el juego', await rt('ana', 'rooms/ana', 'PUT', { host: 'ana', open: false, at: 2, m: { ana: { name: 'Ana', dex: 1, shiny: false, at: 1 } } }), true);
check('sala con host ajeno', await rt('ana', 'rooms/ana/host', 'PUT', 'bob'), false);
check('rin en sala que existe', await rt('bob', 'rin/ana/bob', 'PUT', true), true);
check('rin en sala que no existe', await rt('bob', 'rin/zzz/bob', 'PUT', true), false);
check('borrar mi rin', await rt('bob', 'rin/ana/bob', 'DELETE'), true);

console.log(fails ? `\n${fails} fallan` : '\ntodo bien');
process.exit(fails ? 1 : 0);
