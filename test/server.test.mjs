import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';

test('shared club: authentication, permissions, persistence, validation and conflicts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'luoyun-test-'));
  let app = createApp({ dataDir: directory, setupToken: 'test-setup-token' });
  await new Promise(done => app.listen(0, '127.0.0.1', done));
  let base = 'http://127.0.0.1:' + app.address().port, ownerCookie = '', elderCookie = '', state;
  const close = () => new Promise(done => app.close(done));
  t.after(async () => {
    await close();
    const actual = realpathSync(directory);
    assert.ok(actual.startsWith(resolve(tmpdir()) + '\\luoyun-test-') || actual.startsWith(resolve(tmpdir()) + '/luoyun-test-'));
    rmSync(actual, { recursive: true });
  });
  async function request(path, body, cookie = ownerCookie, origin = base) {
    const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
  }
  async function act(action, payload = {}, cookie = ownerCookie, expected = 200) {
    const res = await request('/api/action', { version: state.version, action, ...payload }, cookie);
    assert.equal(res.status, expected, JSON.stringify(res.body));
    if (res.status === 200) state = res.body;
    return res;
  }
  const owner = { account: 'owner', name: '測試掌門', pin: 'Owner-test-982!', token: 'test-setup-token' };

  await t.test('public output is sanitized and admin data is protected', async () => {
    assert.equal((await request('/api/state', undefined, '')).status, 401);
    const res = await request('/api/public', undefined, '');
    assert.equal(res.status, 200); assert.ok(res.body.events[0].roster.length > 0);
    for (const row of res.body.events[0].roster) assert.deepEqual(Object.keys(row).sort(), ['gender', 'level', 'nickname', 'status']);
    assert.equal(res.body.admins, undefined); assert.equal(res.body.logs, undefined);
    const html = await fetch(base + '/'); assert.match(await html.text(), /name="club-live"/);
    assert.equal((await fetch(base + '/data/club.sqlite')).status, 404);
    assert.equal((await fetch(base + '/server.mjs')).status, 404);
  });
  await t.test('first setup requires a secret and secure password; no second setup', async () => {
    assert.equal((await request('/api/setup', { ...owner, token: 'wrong' })).status, 403);
    assert.equal((await request('/api/setup', { ...owner, pin: '123' })).status, 400);
    const res = await request('/api/setup', owner);
    assert.equal(res.status, 200); assert.match(res.cookie, /HttpOnly; SameSite=Strict/);
    ownerCookie = res.cookie.split(';')[0];
    state = (await request('/api/state')).body;
    assert.equal(state.admins.length, 1);
    assert.equal((await request('/api/setup', { ...owner, account: 'nobody' })).status, 404);
    assert.doesNotMatch(JSON.stringify(state), /Owner-test|"pin"|"hash"/);
  });
  await t.test('same-origin writes required and invalid passwords rejected', async () => {
    assert.equal((await request('/api/login', owner, '', 'https://evil.example')).status, 403);
    assert.equal((await request('/api/login', { account: 'owner', pin: 'wrong' }, '')).status, 401);
  });
  let memberId, eventId, elderId, venueId;
  await t.test('member creation, duplicate validation and event limits', async () => {
    memberId = (await act('saveMember', { row: { nickname: '測試弟子', gender: 'female', level: 5, referrer: '私人備註' } })).body.resultId;
    await act('saveMember', { row: { nickname: '測試弟子', gender: 'female', level: 5 } }, ownerCookie, 400);
    await act('saveMember', { row: { nickname: 'bad', gender: 'female', level: 9 } }, ownerCookie, 400);
    const row = { title: '測試活動', dateText: '9/30 (三)', startTime: '10:00', endTime: '12:00', place: '測試場館', courts: 2, fee: 200, note: '' };
    await act('saveEvent', { row: { ...row, courts: -1 } }, ownerCookie, 400);
    await act('saveEvent', { row: { ...row, courts: 1.5 } }, ownerCookie, 400);
    await act('saveEvent', { row: { ...row, endTime: '09:00' } }, ownerCookie, 400);
    eventId = (await act('saveEvent', { row })).body.resultId;
  });
  await t.test('venue presets and moderated public signup intents', async () => {
    venueId = (await act('saveVenue', { row: { name: '測試仙山球館', address: '測試路 1 號', mapUrl: 'https://maps.google.com/?q=test', parking: '地下停車場', facilities: '飲水機', defaultCourts: 3, defaultFee: 180, note: '二樓集合' } })).body.resultId;
    const ev = state.events.find(e => e.id === eventId);
    await act('saveEvent', { id: eventId, row: { ...ev, venueId, place: '測試仙山球館（測試路 1 號）', signupDeadline: '2099-12-31T23:59' } });
    const signup = { eventId, nickname: '訪客小羽', gender: 'female', level: 3, status: 'maybe', note: '朋友介紹' };
    assert.equal((await request('/api/intent', signup, '')).status, 200);
    assert.equal((await request('/api/intent', signup, '')).status, 409);
    state = (await request('/api/state')).body;
    assert.equal(state.intents.length, 1);
    assert.equal(state.events.find(e => e.id === eventId).roster.some(r => r.nickname === '訪客小羽'), false);
    const pub = (await request('/api/public', undefined, '')).body;
    const publicEvent = pub.events.find(e => e.id === eventId);
    assert.equal(publicEvent.pendingCount, 1); assert.equal(publicEvent.venue.address, '測試路 1 號');
    assert.equal(publicEvent.venue.updatedBy, undefined); assert.equal(pub.intents, undefined);
    await act('approveIntent', { id: state.intents[0].id });
    assert.equal(state.intents.length, 0);
    assert.equal(state.events.find(e => e.id === eventId).roster.find(r => r.nickname === '訪客小羽').status, 'maybe');
    assert.equal((await request('/api/intent', { ...signup, nickname: '候補訪客', status: 'wait' }, '')).status, 200);
    state = (await request('/api/state')).body;
    await act('rejectIntent', { id: state.intents[0].id }); assert.equal(state.intents.length, 0);
    await act('saveEvent', { id: eventId, row: { ...state.events.find(e => e.id === eventId), signupDeadline: '2020-01-01T00:00' } });
    assert.equal((await request('/api/intent', { ...signup, nickname: '逾期訪客' }, '')).status, 409);
  });
  await t.test('roster update reaches public output and preserves linked identities', async () => {
    await act('writeRoster', { id: eventId, roster: [{ rid: 'r-test', memberId, nickname: '偽造名稱', gender: 'male', level: 1, status: 'going' }] });
    const pub = (await request('/api/public')).body.events.find(e => e.title === '測試活動');
    assert.equal(pub.roster[0].nickname, '測試弟子'); assert.equal(pub.roster[0].referrer, undefined);
    const ev = state.events.find(e => e.id === eventId);
    await act('writeRoster', { id: eventId, roster: [...ev.roster, { ...ev.roster[0], rid: 'another' }] }, ownerCookie, 400);
    await act('writeRoster', { id: eventId, roster: [{ ...ev.roster[0], status: 'bad' }] }, ownerCookie, 400);
  });
  await t.test('stale editor rejected; only one concurrent edit wins', async () => {
    const version = state.version;
    const payload = { version, action: 'saveEvent', id: eventId, row: state.events.find(e => e.id === eventId) };
    const results = await Promise.all([request('/api/action', payload), request('/api/action', payload)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    state = (await request('/api/state')).body;
    assert.equal(state.version, version + 1);
  });
  await t.test('guest plus member enrollment is atomic', async () => {
    const before = state.members.length;
    await act('addGuest', { id: eventId, row: { nickname: '測試弟子', gender: 'male', level: 4, status: 'going', addToDb: true } }, ownerCookie, 400);
    assert.equal((await request('/api/state')).body.members.length, before);
    await act('addGuest', { id: eventId, row: { nickname: '新散修', gender: 'male', level: 4, status: 'wait', addToDb: true } });
    assert.equal(state.members.length, before + 1);
    assert.equal(state.events.find(e => e.id === eventId).roster.length, 2);
  });
  await t.test('elder permissions enforced on server, including own password verification', async () => {
    elderId = (await act('saveAdmin', { row: { account: 'elder', name: '測試長老', pin: '1357', superAdmin: false } })).body.resultId;
    const login = await request('/api/login', { account: 'elder', pin: '1357' }, '');
    elderCookie = login.cookie.split(';')[0];
    await act('saveAdmin', { row: { account: 'hacker', name: 'H', pin: 'password1', superAdmin: true } }, elderCookie, 403);
    await act('changePin', { id: elderId, pin: 'Changed-982!', currentPassword: 'wrong' }, elderCookie, 403);
    assert.equal((await request('/api/backup', undefined, elderCookie)).status, 403);
    const backup = await request('/api/backup'); assert.equal(backup.status, 200);
    assert.doesNotMatch(JSON.stringify(backup.body), /1357|"hash"|"pin"/);
  });
  await t.test('last super admin cannot be deleted or demoted; rollback is complete', async () => {
    const ad = state.admins.find(a => a.account === 'owner');
    await act('removeAdmin', { id: ad.id }, ownerCookie, 400);
    await act('saveAdmin', { id: ad.id, row: { ...ad, superAdmin: false } }, ownerCookie, 400);
    assert.equal((await request('/api/state')).status, 200);
    const login = await request('/api/login', owner, ''); assert.equal(login.status, 200);
  });
  await t.test('password change revokes existing sessions and old password', async () => {
    await act('changePin', { id: elderId, pin: 'Changed-982!', currentPassword: '1357' }, elderCookie);
    assert.equal((await request('/api/state', undefined, elderCookie)).status, 401);
    assert.equal((await request('/api/login', { account: 'elder', pin: 'Elder-test-982!' }, '')).status, 401);
    assert.equal((await request('/api/login', { account: 'elder', pin: 'Changed-982!' }, '')).status, 200);
  });
  await t.test('deleting member retains the latest identity in past rosters', async () => {
    await act('saveMember', { id: memberId, row: { nickname: '新道號', gender: 'female', level: 6 } });
    await act('removeMember', { id: memberId });
    const r = state.events.find(e => e.id === eventId).roster[0];
    assert.equal(r.nickname, '新道號'); assert.equal(r.memberId, null);
  });
  await t.test('data and sessions survive server restart', async () => {
    const version = state.version;
    await close(); app = createApp({ dataDir: directory });
    await new Promise(done => app.listen(0, '127.0.0.1', done)); base = 'http://127.0.0.1:' + app.address().port;
    state = (await request('/api/state')).body;
    assert.equal(state.version, version); assert.ok(state.events.some(e => e.id === eventId));
    assert.ok(state.logs.some(l => l.act === '納入散修'));
    const raw = readFileSync(join(directory, 'club.sqlite'));
    assert.equal(raw.includes(Buffer.from(owner.pin)), false);
  });
  await t.test('logout invalidates session', async () => {
    assert.equal((await request('/api/logout', {})).status, 200);
    assert.equal((await request('/api/state')).status, 401);
  });
  await t.test('repeated failed login is rate limited', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', { account: 'missing', pin: 'incorrect' }, '')).status, 401);
    assert.equal((await request('/api/login', { account: 'missing', pin: 'incorrect' }, '')).status, 429);
  });
  await t.test('setup token resets a forgotten owner password without touching the roster', async () => {
    const before = (await request('/api/public', undefined, '')).body, adminCount = state.admins.length;
    // 正式站的救援流程：金鑰只存在主機上（這裡是 data/setup-token.txt，雲端是 SETUP_TOKEN）。
    const token = readFileSync(join(directory, 'setup-token.txt'), 'utf8').trim();
    assert.equal((await request('/api/setup', { ...owner, pin: 'Recovered-982!', token: 'wrong' }, '')).status, 403);
    const res = await request('/api/setup', { ...owner, pin: 'Recovered-982!', token }, '');
    assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(res.body.me.account, 'owner');
    ownerCookie = res.cookie.split(';')[0];
    assert.equal((await request('/api/login', { account: 'owner', pin: owner.pin }, '')).status, 401);
    assert.equal((await request('/api/login', { account: 'owner', pin: 'Recovered-982!' }, '')).status, 200);
    state = (await request('/api/state')).body;
    assert.equal(state.admins.length, adminCount);
    assert.equal(state.admins.filter(a => a.superAdmin).length, 1);
    assert.ok(state.logs.some(l => l.act === '以初始化金鑰重設掌門密碼'));
    assert.deepEqual((await request('/api/public', undefined, '')).body.events, before.events);
  });
});
