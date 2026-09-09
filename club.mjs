import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
function reject(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, label, max = 160, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) reject(label + '格式不正確');
  return value.trim();
}
function number(value, label, min, max) {
  if (value === '' || value == null || !['number', 'string'].includes(typeof value)) reject(label + '不可空白');
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) reject(label + '超出範圍');
  return n;
}
function password(value) {
  const valid = typeof value === 'string' && value.length <= 128 && (/^\d{4,8}$/.test(value) || value.length >= 8);
  if (!valid) reject('口令需為 4–8 位數 PIN，或 8–128 個字元密碼');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(value, salt, 64).toString('hex');
}
function verify(value, hash) {
  const [salt, key] = hash.split(':');
  return typeof value === 'string' && value.length <= 128 && timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(key, 'hex'));
}
function member(row) {
  if (!row || typeof row !== 'object') reject('名冊資料格式不正確');
  if (!['male', 'female'].includes(row.gender)) reject('請選擇性別');
  return { nickname: text(row.nickname, '暱稱', 80), gender: row.gender,
    level: number(row.level, '程度', 1, 8), referrer: text(row.referrer ?? '', '備註', 500, true) };
}
function event(row) {
  if (!row || typeof row !== 'object') reject('活動資料格式不正確');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(row.startTime) || !time.test(row.endTime) || row.endTime <= row.startTime) reject('結束時間必須晚於開始時間（同日）');
  return { title: text(row.title, '名稱'), dateText: text(row.dateText, '日期', 40),
    startTime: row.startTime, endTime: row.endTime, place: text(row.place, '地點', 300),
    courts: number(row.courts, '場地面數', 1, 12), fee: number(row.fee, '費用', 0, 100000),
    note: text(row.note ?? '', '補充事項', 4000, true) };
}
function account(row) {
  const account = text(row.account, '帳號', 40).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(account)) reject('帳號限英文字母、數字、點、底線與連字號');
  return { account, name: text(row.name, '長老名號', 80), superAdmin: row.superAdmin === true };
}
function publicData(state) {
  return { generatedAt: state.updatedAt, version: state.version, events: state.events.map(ev => ({
    ...event(ev), roster: ev.roster.map(r => {
      const m = state.members.find(m => m.id === r.memberId) || r;
      return { nickname: m.nickname, gender: m.gender, level: m.level, status: r.status };
    })
  })) };
}
export function seed(snapshot) {
  const members = [];
  const events = snapshot.events.map((ev, i) => ({ ...event(ev), id: randomUUID(), seq: i + 1,
    roster: ev.roster.map(r => {
      let m = members.find(m => m.nickname === r.nickname);
      if (!m) { m = { ...member(r), id: randomUUID(), seq: members.length + 1 }; members.push(m); }
      return { ...m, rid: randomUUID(), memberId: m.id, status: r.status };
    })
  }));
  return { members, events, admins: [], logs: [], version: 0, updatedAt: snapshot.generatedAt };
}

export function createHandler({ db, initialState, setupToken, origin = '', secureCookies = false, readHtml }) {
  db.exec(`CREATE TABLE IF NOT EXISTS club (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passwords (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, adminId TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
  if (!db.prepare('SELECT id FROM club').get()) db.prepare('INSERT INTO club VALUES (1,?)').run(JSON.stringify(initialState));
  const getState = () => JSON.parse(db.prepare('SELECT json FROM club WHERE id=1').get().json);
  const saveState = state => db.prepare('UPDATE club SET json=? WHERE id=1').run(JSON.stringify(state));
  const dummyHash = password(randomBytes(24).toString('hex'));
  function throttle(req, name) {
    const time = Date.now();
    db.prepare('DELETE FROM attempts WHERE until<=?').run(time);
    for (const key of ['ip:' + req.socket.remoteAddress, 'account:' + name]) {
      const entry = db.prepare('SELECT count, until FROM attempts WHERE key=?').get(key) || { count: 0, until: time + 15 * 60 * 1000 };
      if (++entry.count > (key.startsWith('ip:') ? 40 : 10)) reject('嘗試次數過多，請於 15 分鐘後再試', 429);
      db.prepare('INSERT INTO attempts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, until=excluded.until').run(key, entry.count, entry.until);
    }
  }
  function session(req, state) {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)bd_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) return null;
    const row = db.prepare('SELECT adminId FROM sessions WHERE token=? AND expires>?').get(digest(token), Date.now());
    return state.admins.find(a => a.id === row?.adminId) || null;
  }
  function cookie(res, id) {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), id, Date.now() + 12 * 3600 * 1000);
    res.setHeader('Set-Cookie', `bd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${(secureCookies || origin.startsWith('https:')) ? '; Secure' : ''}`);
  }
  function audit(state, me, act, target = '', detail = '') {
    state.logs.unshift({ t: now(), who: me.account, name: me.name, act, target, detail });
    state.logs = state.logs.slice(0, 400);
    state.version++; state.updatedAt = now();
  }
  function mutate(state, me, body) {
    if (body.version !== state.version) reject('其他長老已更新資料。已載入最新版本，請關閉編輯視窗後重新操作。', 409);
    const { action, row = {}, id } = body;
    let target = '', resultId = id;
    const find = collection => { const r = collection.find(x => x.id === id); if (!r) reject('資料已不存在', 404); return r; };
    const uniqueName = (rows, value, exclude) => {
      if (rows.some(r => r.id !== exclude && r.nickname.toLowerCase() === value.toLowerCase())) reject('這個暱稱已經存在');
    };
    const upsert = (rows, fields) => {
      const old = id ? find(rows) : null;
      const next = { ...old, ...fields, id: old?.id || randomUUID(), seq: old?.seq || Math.max(0, ...rows.map(r => r.seq || 0)) + 1,
        createdAt: old?.createdAt || now(), updatedAt: now(), updatedBy: me.account };
      if (old) rows[rows.indexOf(old)] = next; else rows.push(next);
      resultId = next.id; return next;
    };
    if (action === 'saveMember') {
      const fields = member(row); uniqueName(state.members, fields.nickname, id);
      upsert(state.members, fields); target = fields.nickname;
    } else if (action === 'removeMember') {
      const old = find(state.members); target = old.nickname;
      // Preserve the latest identity in historical event rows before removing the member.
      for (const ev of state.events) ev.roster = ev.roster.map(r => r.memberId === id ? { ...r, ...member(old), memberId: null } : r);
      state.members = state.members.filter(m => m.id !== id);
    } else if (action === 'saveEvent') {
      const fields = event(row);
      upsert(state.events, { ...fields, roster: id ? find(state.events).roster : [] }); target = fields.title;
    } else if (action === 'removeEvent') {
      target = find(state.events).title; state.events = state.events.filter(ev => ev.id !== id);
    } else if (action === 'writeRoster') {
      const ev = find(state.events);
      if (!Array.isArray(body.roster) || body.roster.length > 500) reject('名單格式不正確或超過 500 人');
      const seen = new Set(), names = new Set();
      ev.roster = body.roster.map(r => {
        if (!r || !['going', 'maybe', 'wait'].includes(r.status)) reject('報名狀態不正確');
        const rid = text(r.rid, '名單識別碼', 100);
        if (seen.has(rid)) reject('名單有重複資料'); seen.add(rid);
        let linked = r.memberId ? state.members.find(m => m.id === r.memberId) : null;
        if (r.memberId && !linked) reject('弟子已除名，請重新整理');
        const fields = member(linked || r), key = fields.nickname.toLowerCase();
        if (names.has(key)) reject('同一場不可重複報名'); names.add(key);
        const prev = ev.roster.find(x => x.rid === rid);
        return { ...fields, rid, memberId: linked?.id || null, status: r.status,
          addedBy: prev?.addedBy || me.account, addedAt: prev?.addedAt || now() };
      });
      ev.updatedAt = now(); target = ev.title;
    } else if (action === 'addGuest') {
      const ev = find(state.events), fields = member(row);
      if (!['going', 'maybe', 'wait'].includes(row.status)) reject('報名狀態不正確');
      if (ev.roster.length >= 500) reject('名單超過 500 人');
      if (ev.roster.some(r => (state.members.find(m => m.id === r.memberId) || r).nickname.toLowerCase() === fields.nickname.toLowerCase())) reject('同一場不可重複報名');
      let memberId = null;
      if (row.addToDb) {
        uniqueName(state.members, fields.nickname);
        memberId = randomUUID(); state.members.push({ ...fields, id: memberId, seq: state.members.length + 1, createdAt: now() });
      }
      ev.roster.push({ ...fields, memberId, rid: randomUUID(), status: row.status, addedBy: me.account, addedAt: now() });
      target = ev.title + '・' + fields.nickname;
    } else if (['saveAdmin', 'removeAdmin', 'changePin'].includes(action)) {
      if (!me.superAdmin && !(action === 'changePin' && me.id === id)) reject('需要掌門權限', 403);
      if (action === 'saveAdmin') {
        const fields = account(row);
        if (state.admins.some(a => a.id !== id && a.account === fields.account)) reject('帳號已存在');
        const ad = upsert(state.admins, fields); target = ad.account;
        if (!id) db.prepare('INSERT INTO passwords VALUES (?,?)').run(ad.id, password(row.pin));
      } else if (action === 'removeAdmin') {
        target = find(state.admins).account; state.admins = state.admins.filter(a => a.id !== id);
        db.prepare('DELETE FROM passwords WHERE id=?').run(id);
        db.prepare('DELETE FROM sessions WHERE adminId=?').run(id);
      } else {
        target = find(state.admins).account;
        if (me.id === id && !verify(body.currentPassword, db.prepare('SELECT hash FROM passwords WHERE id=?').get(id).hash)) reject('目前密碼不正確', 403);
        db.prepare('UPDATE passwords SET hash=? WHERE id=?').run(password(body.pin), id);
        db.prepare('DELETE FROM sessions WHERE adminId=?').run(id);
      }
      if (!state.admins.some(a => a.superAdmin)) reject('至少必須保留一位掌門');
    } else reject('不支援的操作');
    const labels = { saveMember: '儲存弟子', removeMember: '除名弟子', saveEvent: '儲存集結', removeEvent: '撤除集結', writeRoster: '更新陣列', addGuest: '納入散修', saveAdmin: '更新長老', removeAdmin: '革除長老', changePin: '變更密碼' };
    audit(state, me, labels[action], target);
    return resultId;
  }
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) reject('不支援的請求', 405);
        const files = { '/': 'index.html', '/index.html': 'index.html', '/console.html': 'console.html', '/health': null };
        if (!Object.hasOwn(files, path)) reject('找不到頁面', 404);
        if (path === '/health') return json({ ok: true });
        let html = readHtml(files[path]);
        // Live pages never silently display the repository's historical snapshot on an API error.
        html = html.replace('<head>', '<head><meta name="club-live" content="true">')
          .replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, '$1{}$2');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(req.method === 'HEAD' ? '' : html);
      }
      if (!['GET', 'POST'].includes(req.method)) reject('不支援的請求', 405);
      let body = {};
      if (req.method === 'POST') {
        const expected = origin || req.origin || 'http://' + req.headers.host;
        if (req.headers.origin !== expected) reject('請從本站操作', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) reject('請使用 JSON', 415);
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) reject('資料過大', 413); }
        try { body = JSON.parse(raw); } catch { reject('JSON 格式不正確'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') reject('資料格式不正確');
      }
      let state = getState();
      const me = session(req, state);
      if (req.method === 'GET' && path === '/api/public') return json(publicData(state));
      if (req.method === 'GET' && path === '/api/session') return json({ me, needsSetup: !state.admins.length });
      if (req.method === 'POST' && ['/api/setup', '/api/login'].includes(path)) {
        const name = String(body.account || '').trim().toLowerCase(); throttle(req, name);
        if (path === '/api/setup') {
          if (state.admins.length) reject('已完成初始化', 409);
          if (!setupToken || typeof body.token !== 'string' || digest(body.token) !== digest(setupToken)) reject('初始化金鑰不正確', 403);
          const ad = { ...account(body), superAdmin: true, id: randomUUID(), seq: 1, createdAt: now() };
          const hash = password(body.pin);
          db.transaction(() => {
            state = getState(); if (state.admins.length) reject('已完成初始化', 409);
            state.admins.push(ad); db.prepare('INSERT INTO passwords VALUES (?,?)').run(ad.id, hash);
            audit(state, ad, '建立掌門'); saveState(state);
          });
          cookie(res, ad.id); return json({ me: ad });
        }
        const ad = state.admins.find(a => a.account === name);
        const hash = ad && db.prepare('SELECT hash FROM passwords WHERE id=?').get(ad.id)?.hash;
        const valid = verify(body.pin, hash || dummyHash);
        if (!ad || !valid) reject('帳號或密碼不正確', 401);
        db.prepare('DELETE FROM attempts WHERE key=?').run('account:' + name); cookie(res, ad.id); return json({ me: ad });
      }
      if (req.method === 'POST' && path === '/api/logout') {
        const token = (req.headers.cookie || '').match(/bd_session=([a-f0-9]{64})/)?.[1];
        if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
        res.setHeader('Set-Cookie', `bd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${(secureCookies || origin.startsWith('https:')) ? '; Secure' : ''}`);
        return json({ ok: true });
      }
      if (!me) reject('請先登入管理後台', 401);
      if (req.method === 'GET' && path === '/api/state') return json({ ...state, me });
      if (req.method === 'GET' && path === '/api/backup') {
        if (!me.superAdmin) reject('需要掌門權限', 403);
        res.setHeader('Content-Disposition', 'attachment; filename="luoyun-backup.json"');
        return json({ format: 'luoyun-data-v1', exportedAt: now(), ...state });
      }
      if (req.method === 'POST' && path === '/api/action') {
        let resultId;
        db.transaction(() => {
          state = getState(); const currentMe = session(req, state); if (!currentMe) reject('請重新登入', 401);
          resultId = mutate(state, currentMe, body); saveState(state);
        });
        return json({ ...state, me: session(req, state), resultId });
      }
      reject('找不到 API', 404);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) json({ error: error.status ? error.message : '伺服器錯誤，請稍後再試' }, error.status || 500);
    }
  };
}
