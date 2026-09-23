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
    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(root.status, 307); assert.equal(root.headers.get('location'), '/console.html');
    const html = await fetch(base + '/console.html'); assert.match(await html.text(), /name="club-live"/);
    const board = await fetch(base + '/board.html');
    assert.equal(board.status, 200);
    assert.match(board.headers.get('content-type'), /text\/html/);
    assert.match(await board.text(), /戰術大板/);
    assert.equal((await fetch(base + '/data/club.sqlite')).status, 404);
    assert.equal((await fetch(base + '/server.mjs')).status, 404);
  });
  await t.test('background assets support GET and HEAD without exposing other files', async () => {
    for (const name of ['yunmeng-mountains-v1.webp', 'yunmeng-mountains-small-v1.webp',
        'yunmeng-dark-v1.jpg', 'yunmeng-dark-small-v1.jpg',
        'yunmeng-light-v1.jpg', 'yunmeng-light-small-v1.jpg']) {
      const path = '/assets/' + name;
      const image = await fetch(base + path);
      assert.equal(image.status, 200);
      const expectedType = name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      assert.equal(image.headers.get('content-type'), expectedType);
      assert.match(image.headers.get('cache-control'), /immutable/);
      const bytes = Buffer.from(await image.arrayBuffer());
      if (name.endsWith('.webp')) {
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      } else {
        assert.equal(bytes[0], 0xFF, 'JPEG SOI marker byte 1');
        assert.equal(bytes[1], 0xD8, 'JPEG SOI marker byte 2');
      }
      const head = await fetch(base + path, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), bytes.length);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
    }
    const css = await fetch(base + '/tailwind.css');
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal((await fetch(base + '/assets/server.mjs')).status, 404);
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
    const row = { title: '測試活動', date: '2026-09-30', dateText: '9/30 (三)', startTime: '10:00', endTime: '12:00', place: '測試場館', courts: 2, fee: 200, note: '' };
    await act('saveEvent', { row: { ...row, courts: -1 } }, ownerCookie, 400);
    await act('saveEvent', { row: { ...row, courts: 1.5 } }, ownerCookie, 400);
    await act('saveEvent', { row: { ...row, endTime: '09:00' } }, ownerCookie, 400);
    await act('saveEvent', { row: { ...row, date: '2026-02-31' } }, ownerCookie, 400);
    eventId = (await act('saveEvent', { row })).body.resultId;
    assert.equal(state.events.find(e => e.id === eventId).date, '2026-09-30');
  });
  await t.test('venue presets and the public page remains read-only', async () => {
    venueId = (await act('saveVenue', { row: { name: '測試仙山球館', address: '測試路 1 號', mapUrl: 'https://maps.google.com/?q=test', parking: '地下停車場', facilities: '飲水機', defaultCourts: 3, defaultFee: 180, note: '二樓集合' } })).body.resultId;
    const ev = state.events.find(e => e.id === eventId);
    await act('saveEvent', { id: eventId, row: { ...ev, venueId, place: '測試仙山球館（測試路 1 號）', signupDeadline: '2099-12-31T23:59' } });
    const signup = { eventId, nickname: '訪客小羽', gender: 'female', level: 3, status: 'maybe', note: '朋友介紹' };
    assert.equal((await request('/api/intent', signup, '')).status, 403);
    state = (await request('/api/state')).body;
    assert.equal(state.intents.length, 0);
    assert.equal(state.events.find(e => e.id === eventId).roster.some(r => r.nickname === '訪客小羽'), false);
    const pub = (await request('/api/public', undefined, '')).body;
    const publicEvent = pub.events.find(e => e.id === eventId);
    assert.equal(publicEvent.venue.address, '測試路 1 號');
    assert.equal(publicEvent.pendingCount, undefined); assert.equal(pub.intents, undefined);
  });
  await t.test('roster update reaches public output and preserves linked identities', async () => {
    await act('writeRoster', { id: eventId, roster: [{ rid: 'r-test', memberId, nickname: '偽造名稱', gender: 'male', level: 1, status: 'going' }] });
    const pub = (await request('/api/public')).body.events.find(e => e.title === '測試活動');
    assert.equal(pub.roster[0].nickname, '測試弟子'); assert.equal(pub.roster[0].referrer, undefined);
    const ev = state.events.find(e => e.id === eventId);
    await act('writeRoster', { id: eventId, roster: [...ev.roster, { ...ev.roster[0], rid: 'another' }] }, ownerCookie, 400);
    await act('writeRoster', { id: eventId, roster: [{ ...ev.roster[0], status: 'bad' }] }, ownerCookie, 400);
  });
  await t.test('gateQr and lineup actions work and appear in publicData', async () => {
    const ev = state.events.find(e => e.id === eventId);
    await act('saveEvent', { id: eventId, row: { ...ev, gateQr: 'data:image/webp;base64,mockqr', gateQrDate: '2026/09/25' } });
    
    // Atomic callLineup with courtNum and lineup (and startedAt conversion)
    const startTimeNum = Date.now() - 5000;
    await act('callLineup', { id: eventId, row: {
      courtNum: 1,
      lineup: {
        courts: [{ courtNum: 1, status: 'waiting', mode: 'balanced', startedAt: startTimeNum, label: '五號場', teamA: ['測試弟子'], teamB: [] }],
        stats: { '測試弟子': 1 },
        since: { '默契道友': 1758585600000 },
        state: { '默契道友': 'wait' },
        times: { '默契道友': { play: 1000, wait: 2000, rest: 3000 } },
        pos: { '測試弟子': { x: 0.3, y: 0.7 } },
        locked: ['測試弟子'],
        pairs: { '測試弟子|默契道友': 3 },
        matchSeq: 3,
        autoMode: 'level',
        lockedPairs: [['測試弟子', '默契道友']]
      }
    } });
    
    let pub = (await request('/api/public')).body.events.find(e => e.id === eventId);
    assert.equal(pub.gateQr, 'data:image/webp;base64,mockqr');
    assert.equal(pub.gateQrDate, '2026/09/25');
    assert.equal(pub.lineup.courts[0].courtNum, 1);
    assert.equal(pub.lineup.courts[0].status, 'idle'); // 'waiting' normalized to 'idle'
    assert.ok(pub.lineup.courts[0].matchStart); // startedAt normalized to matchStart
    assert.equal(pub.lineup.courts[0].teamA[0], '測試弟子');
    assert.equal(pub.lineup.courts[0].label, '五號場'); // court.html 自訂場地名稱要通過 lineupData 白名單
    assert.deepEqual(pub.lineup.lockedPairs, [['測試弟子', '默契道友']]);
    // court.html 的三個時間累計器、狀態、座標與搭配冷卻欄位都要通過 lineupData 白名單
    assert.equal(pub.lineup.since['默契道友'], 1758585600000);
    assert.equal(pub.lineup.state['默契道友'], 'wait');
    assert.deepEqual(pub.lineup.times['默契道友'], { play: 1000, wait: 2000, rest: 3000 });
    assert.deepEqual(pub.lineup.pos['測試弟子'], { x: 0.3, y: 0.7 });
    assert.equal(pub.lineup.pairs['測試弟子|默契道友'], 3);
    assert.equal(pub.lineup.matchSeq, 3);
    assert.equal(pub.lineup.autoMode, 'level');
    assert.deepEqual(pub.lineup.locked, ['測試弟子']); // 輕推鎖定（換場續戰）
    assert.ok(pub.lineup.announcedAt);
    assert.equal(pub.lineup.announcedCourt, 1);
    const savedAnnouncedAt = pub.lineup.announcedAt;

    // Subsequent updateLineup without announcedAt preserves existing announcedAt
    await act('updateLineup', { id: eventId, row: { lineup: {
      courts: [{ courtNum: 1, status: 'playing', matchStart: pub.lineup.courts[0].matchStart, teamA: ['測試弟子'], teamB: [] }]
    } } });
    pub = (await request('/api/public')).body.events.find(e => e.id === eventId);
    assert.equal(pub.lineup.announcedAt, savedAnnouncedAt, 'announcedAt must be retained after updateLineup');

    // lineupData safely filters out null and undefined values without stringifying to 'null'
    await act('updateLineup', { id: eventId, row: { lineup: {
      courts: [{ courtNum: 1, status: 'playing', teamA: [null, undefined, '  ', '測試弟子'], teamB: [] }]
    } } });
    pub = (await request('/api/public')).body.events.find(e => e.id === eventId);
    assert.deepEqual(pub.lineup.courts[0].teamA, ['測試弟子']);

    // Public /api/rest rejects invalid nickname, overlong strings, and non-roster attendees
    assert.equal((await request('/api/rest', { eventId, nickname: '' }, '')).status, 400);
    assert.equal((await request('/api/rest', { eventId, nickname: 'x'.repeat(85) }, '')).status, 400);
    assert.equal((await request('/api/rest', { eventId, nickname: '陌生散修' }, '')).status, 404);

    const verBeforeRest = state.version;
    const restOn = await request('/api/rest', { eventId, nickname: '測試弟子', resting: true }, '');
    assert.equal(restOn.status, 200);
    assert.deepEqual(restOn.body.resting, ['測試弟子']);
    assert.equal(restOn.body.version, verBeforeRest + 1);

    const pubRest = (await request('/api/public')).body.events.find(e => e.id === eventId);
    assert.deepEqual(pubRest.lineup.resting, ['測試弟子']);

    // Stale editor using verBeforeRest is now rejected with 409
    await act('updateLineup', { version: verBeforeRest, id: eventId, row: { lineup: { courts: [] } } }, ownerCookie, 409);

    // Refresh state and reset rest
    state = (await request('/api/state')).body;
    const restOff = await request('/api/rest', { eventId, nickname: '測試弟子', resting: false }, '');
    assert.equal(restOff.status, 200);
    assert.deepEqual(restOff.body.resting, []);
    state = (await request('/api/state')).body;
  });
  await t.test('stale editor rejected; only one concurrent edit wins', async () => {
    const version = state.version;
    const payload = { version, action: 'saveEvent', id: eventId, row: state.events.find(e => e.id === eventId) };
    const results = await Promise.all([request('/api/action', payload), request('/api/action', payload)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    state = (await request('/api/state')).body;
    assert.equal(state.version, version + 1);
  });
  await t.test('new event initializes clean lineup and expired gateQr is stripped from publicData', async () => {
    // 1. Creating new event passing old lineup in row -> lineup must be reset to null
    const oldEv = state.events.find(e => e.id === eventId);
    const newId = (await act('saveEvent', { row: {
      ...oldEv,
      title: '全新集結',
      date: '2026-10-15',
      dateText: '10/15 (四)',
      lineup: { courts: [{ courtNum: 1, teamA: ['舊弟子'] }] }
    } })).body.resultId;
    state = (await request('/api/state')).body;
    const createdEv = state.events.find(e => e.id === newId);
    assert.equal(createdEv.lineup, null, 'New event must not inherit lineup');

    // 2. An event with date 10 days ago should have gateQr stripped in publicData
    await act('saveEvent', { id: newId, row: {
      ...createdEv,
      date: '2026-09-01',
      gateQr: 'data:image/webp;base64,ancientqr'
    } });
    const pub = (await request('/api/public')).body.events.find(e => e.id === newId);
    assert.equal(pub.gateQr, '', 'Expired event gateQr must be empty in publicData');
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
    await act('changeHonorific', { id: elderId, row: { title: '羽球護法' } }, elderCookie);
    assert.equal(state.admins.find(a => a.id === elderId).title, '羽球護法');
    const ownerId = state.admins.find(a => a.account === 'owner').id;
    await act('changeHonorific', { id: ownerId, row: { title: '越權稱號' } }, elderCookie, 403);
    // 掌門稱號必須對應真的掌門權限：長老自己改不動，掌門也不能掛到長老頭上
    await act('changeHonorific', { id: elderId, row: { title: '落雲宗掌門' } }, elderCookie, 403);
    await act('changeHonorific', { id: elderId, row: { title: '落雲宗掌門' } }, ownerCookie, 403);
    assert.equal(state.admins.find(a => a.id === elderId).title, '羽球護法');
    await act('changeHonorific', { id: ownerId, row: { title: '落雲宗掌門', mood: '坐鎮山門' } }, ownerCookie);
    assert.equal(state.admins.find(a => a.id === ownerId).title, '落雲宗掌門');
    assert.equal(state.admins.find(a => a.id === ownerId).mood, '坐鎮山門');
    await act('changePin', { id: elderId, pin: 'Changed-982!', currentPassword: 'wrong' }, elderCookie, 403);
    assert.equal((await request('/api/backup', undefined, elderCookie)).status, 403);
    const backup = await request('/api/backup'); assert.equal(backup.status, 200);
    assert.equal(backup.body.admins.some(function (admin) {
      return Object.hasOwn(admin, 'hash') || Object.hasOwn(admin, 'pin') || Object.values(admin).includes('1357');
    }), false);
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
  await t.test('member rename propagates to lineup courts, queue, resting, lockedPairs and stats', async () => {
    // Pick or create a member
    const m = state.members[0];
    const oldNick = m.nickname;
    const newNick = '更名仙尊';

    // Set up lineup with oldNick across courts, queue, resting, lockedPairs, and stats
    await act('updateLineup', { id: eventId, row: { lineup: {
      courts: [{ courtNum: 1, status: 'playing', teamA: [oldNick], teamB: [] }],
      queue: [{ id: 'q-test-1', mode: 'balanced', teamA: [oldNick], teamB: [] }],
      resting: [oldNick],
      lockedPairs: [[oldNick, '道友甲']],
      stats: { [oldNick]: 5 },
      since: { [oldNick]: 1758585600000 },
      pos: { [oldNick]: { x: 0.5, y: 0.5 } },
      locked: [oldNick]
    } } });

    // Rename member via saveMember
    await act('saveMember', { id: m.id, row: { ...m, nickname: newNick } });
    state = (await request('/api/state')).body;

    const ev = state.events.find(e => e.id === eventId);
    assert.deepEqual(ev.lineup.courts[0].teamA, [newNick]);
    assert.deepEqual(ev.lineup.queue[0].teamA, [newNick]);
    assert.deepEqual(ev.lineup.resting, [newNick]);
    assert.equal(ev.lineup.since[newNick], 1758585600000);
    assert.equal(ev.lineup.since[oldNick], undefined);
    assert.deepEqual(ev.lineup.pos[newNick], { x: 0.5, y: 0.5 });
    assert.deepEqual(ev.lineup.locked, [newNick]);
    assert.deepEqual(ev.lineup.lockedPairs, [[newNick, '道友甲']]);
    assert.equal(ev.lineup.stats[newNick], 5);
    assert.equal(ev.lineup.stats[oldNick], undefined);
    const attendee = ev.roster.find(r => r.memberId === m.id);
    if (attendee) assert.equal(attendee.nickname, newNick);

    // Revert rename for clean state
    await act('saveMember', { id: m.id, row: { ...m, nickname: oldNick } });
    state = (await request('/api/state')).body;
  });
});
