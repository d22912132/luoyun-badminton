import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const now = () => new Date().toISOString();
// 「落雲宗掌門」必須對應真的掌門權限，不能只是自己填上去的稱號
const MASTER_TITLE = '落雲宗掌門';
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
function lineupData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cleanList = arr => Array.isArray(arr) ? arr.filter(p => p != null && String(p).trim()).map(p => String(p).trim()) : [];
  return {
    courts: Array.isArray(raw.courts) ? raw.courts.map(c => {
      let matchStart = typeof c.matchStart === 'string' ? c.matchStart : null;
      if (!matchStart && c.startedAt) {
        matchStart = typeof c.startedAt === 'number' ? new Date(c.startedAt).toISOString() : String(c.startedAt);
      }
      return {
        courtNum: Number(c.courtNum) || 1,
        status: ['idle', 'waiting', 'playing', 'finished'].includes(c.status) ? (c.status === 'waiting' ? 'idle' : c.status) : 'idle',
        mode: ['free', 'balanced', 'mixed', 'mens', 'womens', 'singles'].includes(c.mode) ? c.mode : 'free',
        teamA: cleanList(c.teamA),
        teamB: cleanList(c.teamB),
        matchStart,
        nextTeamA: cleanList(c.nextTeamA),
        nextTeamB: cleanList(c.nextTeamB)
      };
    }) : [],
    queue: Array.isArray(raw.queue) ? raw.queue.map((q, idx) => ({
      id: typeof q.id === 'string' ? q.id : 'q-' + Date.now() + '-' + idx,
      mode: ['free', 'balanced', 'mixed', 'mens', 'womens', 'singles'].includes(q.mode) ? q.mode : 'balanced',
      teamA: cleanList(q.teamA),
      teamB: cleanList(q.teamB),
      createdAt: typeof q.createdAt === 'string' ? q.createdAt : now()
    })) : [],
    stats: (raw.stats && typeof raw.stats === 'object') ? raw.stats : {},
    resting: cleanList(raw.resting),
    lockedPairs: Array.isArray(raw.lockedPairs) ? raw.lockedPairs
      .map(cleanList)
      .filter(p => p.length === 2) : [],
    history: Array.isArray(raw.history) ? raw.history.slice(-15) : [],
    announcedAt: typeof raw.announcedAt === 'string' ? raw.announcedAt : null,
    announcedCourt: Number(raw.announcedCourt) || null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now()
  };
}
function event(row) {
  if (!row || typeof row !== 'object') reject('活動資料格式不正確');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(row.startTime) || !time.test(row.endTime) || row.endTime <= row.startTime) reject('結束時間必須晚於開始時間（同日）');
  const signupDeadline = text(row.signupDeadline ?? '', '報名截止時間', 40, true);
  if (signupDeadline && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(signupDeadline)) reject('報名截止時間格式不正確');
  const date = text(row.date ?? '', '活動日期', 10, true);
  if (date) {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/), d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!m || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) reject('活動日期格式不正確');
  }
  const gateQr = typeof row.gateQr === 'string' && row.gateQr.length <= 500000 ? row.gateQr.trim() : '';
  const gateQrDate = text(row.gateQrDate ?? '', '門禁日期', 40, true);
  const lineup = lineupData(row.lineup);
  return { title: text(row.title, '名稱'), date, dateText: text(row.dateText, '日期', 40),
    startTime: row.startTime, endTime: row.endTime, place: text(row.place, '地點', 300),
    courts: number(row.courts, '場地面數', 1, 12), fee: number(row.fee, '費用', 0, 100000),
    note: text(row.note ?? '', '補充事項', 4000, true),
    venueId: text(row.venueId ?? '', '場館識別碼', 100, true), signupDeadline,
    gateQr, gateQrDate, lineup };
}
function venue(row) {
  if (!row || typeof row !== 'object') reject('場館資料格式不正確');
  const mapUrl = text(row.mapUrl ?? '', '地圖連結', 1000, true);
  if (mapUrl && !/^https:\/\//i.test(mapUrl)) reject('地圖連結必須使用 https://');
  return { name: text(row.name, '場館名稱', 120), address: text(row.address ?? '', '地址', 300, true),
    mapUrl, parking: text(row.parking ?? '', '停車資訊', 500, true),
    facilities: text(row.facilities ?? '', '設施資訊', 500, true),
    defaultCourts: number(row.defaultCourts ?? 1, '預設場地面數', 1, 12),
    defaultFee: number(row.defaultFee ?? 0, '預設費用', 0, 100000), note: text(row.note ?? '', '場館備註', 1000, true) };
}
function intent(row) {
  if (!row || typeof row !== 'object') reject('報名意願格式不正確');
  if (!['male', 'female'].includes(row.gender)) reject('請選擇性別');
  if (!['going', 'maybe', 'wait'].includes(row.status)) reject('報名狀態不正確');
  return { nickname: text(row.nickname, '暱稱', 80), gender: row.gender,
    level: number(row.level, '程度', 1, 8), status: row.status,
    note: text(row.note ?? '', '留言', 300, true) };
}
function account(row) {
  const account = text(row.account, '帳號', 40).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(account)) reject('帳號限英文字母、數字、點、底線與連字號');
  return { account, name: text(row.name, '長老名號', 80),
    title: text(row.title ?? '', '職司稱號', 40, true), superAdmin: row.superAdmin === true };
}
function venueFromPlace(place, i = 0) {
  const match = String(place || '').match(/^(.+?)[（(]([^）)]+)[）)]$/);
  const name = (match ? match[1] : place).trim();
  return { id: 'legacy-' + digest(String(place)).slice(0, 16), seq: i + 1, name,
    address: match ? match[2].trim() : '', mapUrl: '', parking: '', facilities: '', defaultCourts: 1,
    defaultFee: 0, note: '', createdAt: now(), updatedAt: now(), updatedBy: 'migration' };
}
function deriveVenues(events) {
  return Array.from(new Set(events.map(ev => ev.place).filter(Boolean))).map((place, i) => {
    const v = venueFromPlace(place, i), sample = events.find(ev => ev.place === place);
    v.defaultCourts = Number(sample?.courts) || 1; v.defaultFee = Number(sample?.fee) || 0;
    const url = String(sample?.note || '').match(/https:\/\/[^｜|\s]+/)?.[0]; if (url) v.mapUrl = url;
    return v;
  });
}
function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  state.members = Array.isArray(state.members) ? state.members : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.admins = Array.isArray(state.admins) ? state.admins : [];
  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.intents = Array.isArray(state.intents) ? state.intents : [];
  if (!Array.isArray(state.venues)) {
    state.venues = deriveVenues(state.events);
  }
  state.updatedAt = state.updatedAt || now();
  state.events = state.events.map(ev => {
    let next = ev;
    if (!ev.date) {
      const md = String(ev.dateText || '').match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})/), year = Number(state.updatedAt.slice(0, 4));
      if (md) next = { ...next, date: year + '-' + String(md[1]).padStart(2, '0') + '-' + String(md[2]).padStart(2, '0') };
    }
    if (next.venueId || !next.place) return next;
    const found = state.venues.find(v => ev.place === v.name || ev.place === v.name + (v.address ? '（' + v.address + '）' : ''));
    return found ? { ...next, venueId: found.id } : next;
  });
  state.version = Number.isInteger(state.version) ? state.version : 0;
  return state;
}
function deadlinePassed(value) {
  return !!value && Date.now() > Date.parse(value + ':00+08:00');
}
function publicData(state) {
  const publicVenue = v => v ? ({ id: v.id, name: v.name, address: v.address, mapUrl: v.mapUrl,
    parking: v.parking, facilities: v.facilities, note: v.note }) : null;
  const threeDaysAgo = Date.now() - 3 * 86400000;
  return { generatedAt: state.updatedAt, version: state.version, venues: state.venues.map(publicVenue), events: state.events.map(ev => {
    const raw = event(ev);
    if (raw.date && Date.parse(raw.date + 'T23:59:59+08:00') < threeDaysAgo) {
      raw.gateQr = '';
    }
    return {
      id: ev.id, ...raw,
      venue: publicVenue(state.venues.find(v => v.id === ev.venueId)), roster: ev.roster.map(r => {
        const m = state.members.find(m => m.id === r.memberId) || r;
        return { nickname: m.nickname, gender: m.gender, level: m.level, status: r.status };
      })
    };
  }) };
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
  const venues = deriveVenues(events);
  events.forEach(ev => { const v = venues.find(v => ev.place === v.name || ev.place === v.name + (v.address ? '（' + v.address + '）' : '')); if (v) ev.venueId = v.id; });
  return { members, events, venues, intents: [], admins: [], logs: [], version: 0, updatedAt: snapshot.generatedAt };
}

export function createHandler({ db, initialState, setupToken, origin = '', secureCookies = false, readHtml }) {
  db.exec(`CREATE TABLE IF NOT EXISTS club (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passwords (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, adminId TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
  if (!db.prepare('SELECT id FROM club').get()) db.prepare('INSERT INTO club VALUES (1,?)').run(JSON.stringify(initialState));
  const getState = () => normalizeState(JSON.parse(db.prepare('SELECT json FROM club WHERE id=1').get().json));
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
  function cookie(res, id, req) {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), id, Date.now() + 12 * 3600 * 1000);
    const isHttps = secureCookies || origin.startsWith('https:') || req?.headers?.['x-forwarded-proto'] === 'https' || req?.socket?.encrypted;
    res.setHeader('Set-Cookie', `bd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${isHttps ? '; Secure' : ''}`);
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
    const uniqueVenue = (value, exclude) => {
      if (state.venues.some(v => v.id !== exclude && v.name.toLowerCase() === value.toLowerCase())) reject('這個場館已經存在');
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
      const old = id ? find(state.members) : null;
      upsert(state.members, fields); target = fields.nickname;
      if (old && old.nickname !== fields.nickname) {
        const fromName = old.nickname, toName = fields.nickname;
        for (const ev of state.events) {
          ev.roster = ev.roster.map(r => r.memberId === id ? { ...r, nickname: fields.nickname, gender: fields.gender, level: fields.level } : r);
          if (ev.lineup) {
            const rename = n => n === fromName ? toName : n;
            if (Array.isArray(ev.lineup.courts)) {
              for (const c of ev.lineup.courts) {
                if (c.teamA) c.teamA = c.teamA.map(rename);
                if (c.teamB) c.teamB = c.teamB.map(rename);
                if (c.nextTeamA) c.nextTeamA = c.nextTeamA.map(rename);
                if (c.nextTeamB) c.nextTeamB = c.nextTeamB.map(rename);
              }
            }
            if (Array.isArray(ev.lineup.queue)) {
              for (const q of ev.lineup.queue) {
                if (q.teamA) q.teamA = q.teamA.map(rename);
                if (q.teamB) q.teamB = q.teamB.map(rename);
              }
            }
            if (Array.isArray(ev.lineup.resting)) ev.lineup.resting = ev.lineup.resting.map(rename);
            if (Array.isArray(ev.lineup.lockedPairs)) {
              ev.lineup.lockedPairs = ev.lineup.lockedPairs.map(pair => pair.map(rename));
            }
            if (ev.lineup.stats && ev.lineup.stats[fromName] != null) {
              ev.lineup.stats[toName] = (ev.lineup.stats[toName] || 0) + ev.lineup.stats[fromName];
              delete ev.lineup.stats[fromName];
            }
          }
        }
      }
    } else if (action === 'removeMember') {
      const old = find(state.members); target = old.nickname;
      // Preserve the latest identity in historical event rows before removing the member.
      for (const ev of state.events) ev.roster = ev.roster.map(r => r.memberId === id ? { ...r, ...member(old), memberId: null } : r);
      state.members = state.members.filter(m => m.id !== id);
    } else if (action === 'saveEvent') {
      const fields = event(row);
      if (fields.venueId && !state.venues.some(v => v.id === fields.venueId)) reject('所選場館已不存在');
      const oldEv = id ? find(state.events) : null;
      upsert(state.events, { ...fields, roster: oldEv ? oldEv.roster : [], lineup: oldEv ? (fields.lineup || oldEv.lineup || null) : null }); target = fields.title;
    } else if (action === 'updateLineup') {
      const ev = find(state.events);
      const prevLineup = ev.lineup;
      ev.lineup = lineupData(row.lineup);
      if (row.announcedCourt || row.callCourt) {
        ev.lineup.announcedAt = now();
        ev.lineup.announcedCourt = Number(row.announcedCourt || row.callCourt);
      } else if (!ev.lineup.announcedAt && prevLineup?.announcedAt) {
        ev.lineup.announcedAt = prevLineup.announcedAt;
        ev.lineup.announcedCourt = prevLineup.announcedCourt;
      }
      ev.updatedAt = now(); target = ev.title;
    } else if (action === 'callLineup') {
      const ev = find(state.events);
      if (row.lineup) ev.lineup = lineupData(row.lineup);
      if (!ev.lineup) ev.lineup = lineupData({});
      ev.lineup.announcedAt = now();
      if (row.courtNum) ev.lineup.announcedCourt = Number(row.courtNum);
      ev.updatedAt = now(); target = ev.title;
    } else if (action === 'removeEvent') {
      target = find(state.events).title; state.events = state.events.filter(ev => ev.id !== id);
      state.intents = state.intents.filter(x => x.eventId !== id);
    } else if (action === 'saveVenue') {
      const fields = venue(row); uniqueVenue(fields.name, id);
      const saved = upsert(state.venues, fields); target = saved.name;
    } else if (action === 'removeVenue') {
      const old = find(state.venues); target = old.name;
      state.events.forEach(ev => { if (ev.venueId === id) ev.venueId = ''; });
      state.venues = state.venues.filter(v => v.id !== id);
    } else if (action === 'approveIntent') {
      const pending = find(state.intents), ev = state.events.find(x => x.id === pending.eventId);
      if (!ev) reject('活動已不存在', 404);
      const existing = state.members.find(m => m.nickname.toLowerCase() === pending.nickname.toLowerCase());
      if (ev.roster.some(r => (state.members.find(m => m.id === r.memberId) || r).nickname.toLowerCase() === pending.nickname.toLowerCase())) reject('此人已在正式名單');
      const fields = member(existing || { nickname: pending.nickname, gender: pending.gender, level: pending.level, referrer: pending.note });
      ev.roster.push({ ...fields, memberId: existing?.id || null, rid: randomUUID(), status: pending.status,
        addedBy: me.account, addedAt: now() });
      state.intents = state.intents.filter(x => x.id !== id); target = ev.title + '・' + pending.nickname;
    } else if (action === 'rejectIntent') {
      const pending = find(state.intents), ev = state.events.find(x => x.id === pending.eventId);
      state.intents = state.intents.filter(x => x.id !== id); target = (ev?.title || '已刪除活動') + '・' + pending.nickname;
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
    } else if (['saveAdmin', 'removeAdmin', 'changePin', 'changeHonorific'].includes(action)) {
      if (!me.superAdmin && !(['changePin', 'changeHonorific'].includes(action) && me.id === id)) reject('需要掌門權限', 403);
      if (action === 'saveAdmin') {
        const fields = account(row);
        // 革除掌門權限時一併收回掌門稱號，避免名冊上留著一個沒有實權的「掌門」
        if (fields.title === MASTER_TITLE && !fields.superAdmin) fields.title = '';
        if (state.admins.some(a => a.id !== id && a.account === fields.account)) reject('帳號已存在');
        const ad = upsert(state.admins, fields); target = ad.account;
        if (!id) db.prepare('INSERT INTO passwords VALUES (?,?)').run(ad.id, password(row.pin));
      } else if (action === 'removeAdmin') {
        target = find(state.admins).account; state.admins = state.admins.filter(a => a.id !== id);
        db.prepare('DELETE FROM passwords WHERE id=?').run(id);
        db.prepare('DELETE FROM sessions WHERE adminId=?').run(id);
      } else if (action === 'changePin') {
        target = find(state.admins).account;
        const currentHash = db.prepare('SELECT hash FROM passwords WHERE id=?').get(id)?.hash;
        if (me.id === id && (!currentHash || !verify(body.currentPassword, currentHash))) reject('目前密碼不正確', 403);
        db.prepare('UPDATE passwords SET hash=? WHERE id=?').run(password(body.pin), id);
        db.prepare('DELETE FROM sessions WHERE adminId=?').run(id);
      } else {
        const ad = find(state.admins);
        const wanted = text(row.title ?? '', '職司稱號', 40, true);
        if (wanted === MASTER_TITLE && !ad.superAdmin) reject('只有掌門能使用「' + MASTER_TITLE + '」這個稱號', 403);
        ad.title = wanted;
        ad.mood = text(row.mood ?? '', '宗門狀態', 20, true);
        ad.updatedAt = now(); ad.updatedBy = me.account;
        target = ad.title || (ad.superAdmin ? MASTER_TITLE : '落雲宗大長老');
      }
      if (!state.admins.some(a => a.superAdmin)) reject('至少必須保留一位掌門');
    } else reject('不支援的操作');
    const labels = { saveMember: '儲存弟子', removeMember: '除名弟子', saveEvent: '儲存集結', removeEvent: '撤除集結',
      saveVenue: '儲存場館', removeVenue: '移除場館', approveIntent: '核准意願', rejectIntent: '婉拒意願',
      writeRoster: '更新陣列', addGuest: '納入散修', saveAdmin: '更新長老', removeAdmin: '革除長老', changePin: '變更口令', changeHonorific: '更換稱號',
      updateLineup: '更新排位', callLineup: '宣佈上場' };
    audit(state, me, labels[action], target);
    return resultId;
  }
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The console embeds the same-origin rite page during its entrance animation.
    // Cross-site framing remains blocked.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) reject('不支援的請求', 405);
        // The console is now the single visitor entry point.  The original public
        // page remains available only as the animation source embedded by the console.
        if (path === '/' || path === '/index.html') {
          res.writeHead(307, { Location: '/console.html' }); return res.end();
        }
        const files = { '/console.html': 'console.html', '/board.html': 'board.html', '/rite.html': 'index.html', '/health': null };
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
        const reqOrigin = req.headers.origin;
        const host = req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
        const defaultOrigin = host ? `${proto}://${host}` : '';
        const expected = origin || req.origin || defaultOrigin;
        const validOrigin = reqOrigin === expected || (!origin && !req.origin && host && (reqOrigin === `https://${host}` || reqOrigin === `http://${host}`));
        if (!validOrigin) reject('請從本站操作', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) reject('請使用 JSON', 415);
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) reject('資料過大', 413); }
        try { body = JSON.parse(raw); } catch { reject('JSON 格式不正確'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') reject('資料格式不正確');
      }
      let state = getState();
      const me = session(req, state);
      if (req.method === 'GET' && path === '/api/public') return json(publicData(state));
      // Public pages are intentionally read-only.  Roster changes belong to elders
      // and administrators through the authenticated management console only.
      if (req.method === 'POST' && path === '/api/intent') {
        return json({ error: '公開頁僅供查看，請聯絡長老或管理員更新名單' }, 403);
      }
      if (req.method === 'POST' && path === '/api/rest') {
        const { eventId, nickname, resting } = body;
        if (!eventId || typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 80) reject('資料不正確');
        const cleanName = nickname.trim();
        db.transaction(() => {
          state = getState();
          const ev = state.events.find(x => x.id === eventId);
          if (!ev) reject('活動已不存在', 404);
          const attendee = ev.roster.find(r => {
            const m = state.members.find(x => x.id === r.memberId) || r;
            return m.nickname.toLowerCase() === cleanName.toLowerCase();
          });
          if (!attendee) reject('非本場集結名單之弟子', 404);
          const canonicalName = (state.members.find(x => x.id === attendee.memberId) || attendee).nickname;
          if (!ev.lineup) ev.lineup = lineupData({});
          const set = new Set((ev.lineup.resting || []).map(n => n.toLowerCase()));
          if (resting) set.add(canonicalName.toLowerCase());
          else set.delete(canonicalName.toLowerCase());
          const nameMap = new Map();
          for (const r of ev.roster) {
            const m = state.members.find(x => x.id === r.memberId) || r;
            nameMap.set(m.nickname.toLowerCase(), m.nickname);
          }
          ev.lineup.resting = Array.from(set).map(k => nameMap.get(k) || k);
          ev.lineup.updatedAt = now();
          ev.updatedAt = now();
          state.version++;
          state.updatedAt = now();
          saveState(state);
        });
        return json({ ok: true, version: state.version, resting: state.events.find(x => x.id === eventId)?.lineup?.resting || [] });
      }
      if (req.method === 'GET' && path === '/api/session') return json({ me, needsSetup: !state.admins.length });
      if (req.method === 'POST' && ['/api/setup', '/api/login'].includes(path)) {
        const name = String(body.account || '').trim().toLowerCase(); throttle(req, name);
        if (path === '/api/setup') {
          if (!setupToken || typeof body.token !== 'string' || digest(body.token) !== digest(setupToken)) reject('初始化金鑰不正確', 403);
          // 忘記掌門密碼時的唯一救援路徑：持有初始化金鑰可重設既有掌門密碼，不會新增帳號或動到名單。
          if (state.admins.length) {
            const old = state.admins.find(a => a.account === name && a.superAdmin);
            if (!old) reject('查無這個掌門帳號', 404);
            const reset = password(body.pin);
            db.transaction(() => {
              state = getState();
              db.prepare('UPDATE passwords SET hash=? WHERE id=?').run(reset, old.id);
              db.prepare('DELETE FROM sessions WHERE adminId=?').run(old.id);
              audit(state, old, '以初始化金鑰重設掌門密碼'); saveState(state);
            });
            cookie(res, old.id, req); return json({ me: old });
          }
          const ad = { ...account(body), superAdmin: true, id: randomUUID(), seq: 1, createdAt: now() };
          const hash = password(body.pin);
          db.transaction(() => {
            state = getState(); if (state.admins.length) reject('已完成初始化', 409);
            state.admins.push(ad); db.prepare('INSERT INTO passwords VALUES (?,?)').run(ad.id, hash);
            audit(state, ad, '建立掌門'); saveState(state);
          });
          cookie(res, ad.id, req); return json({ me: ad });
        }
        const ad = state.admins.find(a => a.account === name);
        const hash = ad && db.prepare('SELECT hash FROM passwords WHERE id=?').get(ad.id)?.hash;
        const valid = verify(body.pin, hash || dummyHash);
        if (!ad || !valid) reject('帳號或密碼不正確', 401);
        db.prepare('DELETE FROM attempts WHERE key=?').run('account:' + name); cookie(res, ad.id, req); return json({ me: ad });
      }
      if (req.method === 'POST' && path === '/api/logout') {
        const token = (req.headers.cookie || '').match(/bd_session=([a-f0-9]{64})/)?.[1];
        if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
        const isHttps = secureCookies || origin.startsWith('https:') || req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
        res.setHeader('Set-Cookie', `bd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isHttps ? '; Secure' : ''}`);
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
