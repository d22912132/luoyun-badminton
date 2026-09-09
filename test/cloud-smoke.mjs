// Run only against an isolated local Wrangler instance: node test/cloud-smoke.mjs
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
let cookie = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, { method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
}
const owner = { token: 'local-worker-test', account: 'worker-test', name: '雲端驗收', pin: 'Worker-test-982!' };
if ((await api('session')).body.needsSetup) {
  const setup = await api('setup', owner); assert.equal(setup.status, 200, JSON.stringify(setup.body));
}
const login = await api('login', owner); assert.equal(login.status, 200, JSON.stringify(login.body));
assert.match(login.cookie, /Secure/); cookie = login.cookie.split(';')[0];
let state = (await api('state')).body;
const initialCount = state.events.length;
const row = { title: 'Worker-' + Date.now(), dateText: '10/1 (四)', startTime: '10:00', endTime: '12:00', courts: 1, fee: 200, place: '本機測試', note: '' };
const created = await api('action', { action: 'saveEvent', version: state.version, row });
assert.equal(created.status, 200, JSON.stringify(created.body));
const id = created.body.resultId;
state = created.body;
const guest = await api('action', { action: 'addGuest', version: state.version, id, row: { nickname: '共編測試', gender: 'female', level: 4, status: 'going' } });
assert.equal(guest.status, 200, JSON.stringify(guest.body));
const stale = await api('action', { action: 'saveEvent', version: state.version, id, row });
assert.equal(stale.status, 409);
state = guest.body;
const pub = (await api('public')).body;
assert.ok(pub.events.find(e => e.title === row.title).roster.some(r => r.nickname === '共編測試'));
const onlyAdmin = state.admins[0];
const demoted = await api('action', { action: 'saveAdmin', version: state.version, id: onlyAdmin.id, row: { ...onlyAdmin, superAdmin: false } });
assert.equal(demoted.status, 400);
assert.equal((await api('state')).body.admins[0].superAdmin, true);
const removed = await api('action', { action: 'removeEvent', version: state.version, id });
assert.equal(removed.status, 200); assert.equal(removed.body.events.length, initialCount);
assert.equal((await api('logout', {})).status, 200);
assert.equal((await api('state')).status, 401);
console.log('Cloudflare runtime: setup, secure login, Unicode data, public sync, conflicts, rollback, deletion and logout passed.');
