import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');

test('歷史卡片僅供管理者刪除，先確認才執行，且刪除按鈕不嵌在開啟按鈕內', async () => {
  let ended = true, confirmed, deleted = 0, opened = 0, allowed = true;
  const E = (tag, props, ...children) => ({ tag, props, children });
  const ctx = vm.createContext({ E, D: (cls, ...children) => E('div', { className: cls }, ...children), S: () => null,
    capacityOf: () => 7, fillPct: () => 0, eventLabel: () => ({}), eventEnded: () => ended,
    gateQrOf: () => '', metaLine: () => null, flow: () => null,
    CARD: '', CARD_HOVER: '', JADE: '', GOLD: '', CIN: '', T1: '', T3: '',
    DateSeal: 'DateSeal', CapacityPill: 'CapacityPill', Icon: 'Icon', Btn: 'Btn' });
  vm.runInContext(html.slice(html.indexOf('  function EventCard('), html.indexOf('  /* ---------------- event detail')), ctx);
  const ev = { id: 'history-test', title: '測試活動', dateText: '10/1', roster: [{}] };
  const p = { isAdmin: true, eventList: 'history', needAdmin: () => allowed,
    setModal: m => { confirmed = m; }, removeEvent: async row => { assert.equal(row, ev); deleted++; return true; },
    setOpenEventId: () => opened++ };
  const card = ctx.EventCard({ ev, p });
  assert.equal(card.tag, 'article');
  assert.equal(card.children[0].tag, 'button');
  const button = card.children[1].children[0];
  assert.equal(button.tag, 'Btn'); assert.equal(button.props.ariaLabel, '刪除歷史活動：測試活動');
  button.props.onClick();
  assert.equal(deleted, 0); assert.equal(opened, 0);
  assert.equal(confirmed.type, 'confirm'); assert.equal(confirmed.danger, true);
  assert.match(confirmed.body, /1 筆出席名單，無法復原/);
  await confirmed.run(); assert.equal(deleted, 1);
  confirmed = undefined; allowed = false; button.props.onClick(); assert.equal(confirmed, undefined);
  for (const fields of [{ isAdmin: false }, { eventList: 'upcoming' }, { eventList: 'drafts' }]) {
    assert.equal(ctx.EventCard({ ev, p: { ...p, ...fields } }).tag, 'button');
  }
  ended = false; assert.equal(ctx.EventCard({ ev, p }).tag, 'button');
});
function rules() {
  class Clock extends Date { static now() { return Date.parse('2026-10-15T12:00:00+08:00'); } }
  const ctx = vm.createContext({ Date: Clock, URLSearchParams, location: { search: '' }, GOLD: 'gold', T3: 'muted', JADE: 'jade' });
  vm.runInContext(html.slice(html.indexOf('  function todayKey()'), html.indexOf('  /* 萬劍歸宗 QR 劍陣：')), ctx);
  vm.runInContext(html.match(/  function deadlineInfo\([^]*?\n  \}/)[0], ctx);
  return ctx;
}

test('門禁內建碼只供指定場館當月使用，自訂圖依場館、今天與活動日期判斷', () => {
  const ctx = rules(), venue = { id: 'v1', name: '亞伯林羽球館－東區振興店' };
  const event = { date: '2026-10-26', venueId: 'v1', place: '亞伯林羽球館', venue };
  assert.equal(ctx.gateQrOf(event), '/gate-qr.png');
  assert.equal(ctx.gateQrOf({ ...event, venue: undefined }, [venue]), '/gate-qr.png');
  assert.equal(ctx.gateQrOf({ ...event, venue: { id: 'v1', name: '其他場館' } }), '');
  assert.equal(ctx.gateQrOf({ ...event, date: '2026-11-01' }), '');
  const custom = { ...event, gateQr: 'custom', gateQrVenue: 'v1', gateQrFrom: '2026-10-01', gateQrDate: '2026-10-31' };
  assert.equal(ctx.gateQrOf(custom), 'custom');
  for (const fields of [{ gateQrVenue: 'v2' }, { gateQrFrom: '2026-10-20' }, { gateQrDate: '2026-10-14' },
    { date: '2026-11-01' }, { gateQrUnavailable: true }]) assert.equal(ctx.gateQrOf({ ...custom, ...fields }), '');
  assert.equal(ctx.gateQrOf({ ...event, gateQrUnavailable: true }), '', '無效自訂圖不可退回看似可用的內建圖');
  const venueWithQr = { ...venue, gateQr: 'venue-half-month-qr', gateQrFrom: '2026-10-01', gateQrDate: '2026-10-31' };
  assert.equal(ctx.gateQrOf({ ...event, venue: undefined }, [venueWithQr]), 'venue-half-month-qr', '活動未設自訂圖時自動繼承場館有效門禁圖');
});

test('活動結束與報名截止使用台灣時間，草稿優先顯示未公開', () => {
  const ctx = rules();
  assert.equal(ctx.eventEnded({ date: '2026-10-15', endTime: '11:59' }), true);
  assert.equal(ctx.eventEnded({ date: '2026-10-15', endTime: '12:01' }), false);
  assert.equal(ctx.deadlineInfo('2026-10-15T12:00', 1, 35).closed, true);
  assert.equal(ctx.deadlineInfo('2026-10-15T12:01', 1, 35).closed, false);
  assert.equal(ctx.eventLabel({ publication: 'draft' }, 1, 35).label, '草稿・尚未公開');
});

test('活動專屬連結可還原場次及歷史分類，舊戰術分頁回到佈告', () => {
  const ctx = rules();
  ctx.location.search = '?event=event-42&list=history';
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.readRoute())), { tab: 'events', event: 'event-42', list: 'history' });
  ctx.location.search = '?tab=board';
  assert.equal(ctx.readRoute().tab, 'events');
});

test('補充事項保留問號、網址與查詢參數，只依換行或分隔線拆段', () => {
  for (const file of ['console.html', 'index.html']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(source.match(/  function notesOf\([^]*?\n  \}/)[0], ctx);
    const result = ctx.notesOf({ note: '導航：https://maps.google.com/?cid=123&x=1\n要帶水嗎？｜請自備' });
    assert.deepEqual(Array.from(result), ['導航：https://maps.google.com/?cid=123&x=1', '要帶水嗎？', '請自備']);
  }
});

test('未儲存表單的取消、離開與重新整理提醒可保留內容，成功儲存後解除提醒', () => {
  const initial = { current: undefined }, listeners = new Set(); let closed = 0, discard;
  const ctx = vm.createContext({
    useRef(value) { if (initial.current === undefined) initial.current = value; return initial; },
    useEffect(fn) { fn(); }, window: {
      addEventListener: type => listeners.add(type), removeEventListener: type => listeners.delete(type) }
  });
  vm.runInContext(html.slice(html.indexOf('  function useFormGuard('), html.indexOf('  function Modal(')), ctx);
  const p = { close() { closed++; }, requestDiscard(run) { discard = run; }, unsavedRef: { current: false } };
  ctx.useFormGuard(p, { title: '' });
  const guard = ctx.useFormGuard(p, { title: '尚未完成' });
  assert.equal(guard.dirty, true); assert.equal(p.unsavedRef.current, true);
  assert.ok(listeners.has('beforeunload'));
  guard.close(); assert.equal(closed, 0);
  assert.equal(typeof discard, 'function'); discard(); assert.equal(closed, 1);
  guard.saved(); assert.equal(p.unsavedRef.current, false);
  assert.equal(ctx.useFormGuard(p, { title: '尚未完成' }).dirty, false);
});

test('QR 儲存失敗不誤報成功，彈窗重新渲染時讀取最新活動圖片', async () => {
  let succeeded = false, seen; const messages = [];
  const ctx = vm.createContext({ useRef: () => ({ current: null }), useState: v => [v, () => {}],
    useFormGuard: () => ({ close() {}, saved() {} }), todayKey: () => '2026-10-15', gateQrOf: ev => { seen = ev.gateQr; return ev.gateQr; },
    gateQrDateOf: () => '', gateQrHint: () => '', E: (tag, props, ...children) => ({ tag, props, children }), D: () => null, S: () => null,
    Modal: 'Modal', Btn: 'Btn', Icon: 'Icon', Field: 'Field', SwordQrSeal: 'SwordQrSeal', INPUT: '', T1: '', T3: '', DEFAULT_GATE_QR_MONTH: '2026-10' });
  vm.runInContext(html.slice(html.indexOf('  function GateQrModal('), html.indexOf('  /* ---------------- venue page')), ctx);
  const old = { id: 'e1', gateQr: 'old', date: '2026-10-26' };
  const p = { events: [{ ...old, gateQr: 'latest' }], venues: [], modal: { ev: old }, isAdmin: true,
    saveEvent: async () => succeeded, flash: msg => messages.push(msg) };
  let modal = ctx.GateQrModal(p);
  assert.equal(seen, 'latest');
  await modal.props.footer.find(item => item?.props.key === 'del').props.onClick();
  assert.deepEqual(messages, []);
  succeeded = true; modal = ctx.GateQrModal(p);
  await modal.props.footer.find(item => item?.props.key === 'del').props.onClick();
  assert.deepEqual(messages, ['門禁碼已清除']);
  const standaloneModal = ctx.GateQrModal({ events: [], venues: [], modal: { type: 'gateQr', date: '2026-11-05' }, isAdmin: false, flash: () => {} });
  assert.equal(standaloneModal.props.title, '門禁玉令產生器（自選日期）');
  assert.equal(standaloneModal.props.sub, '免開團・指定日期：2026-11-05');
});

test('備份下載建立 JSON 檔並釋放暫存網址，失敗時不產生檔案且可重試', async () => {
  const clicked = [], messages = [], busy = [], revoked = [];
  let fail = false;
  const ctx = vm.createContext({ backingUp: false, Blob,
    setBackingUp: value => busy.push(value), todayKey: () => '2026-10-15',
    URL: { createObjectURL: blob => { assert.equal(blob.type, 'application/json'); return 'blob:backup'; }, revokeObjectURL: url => revoked.push(url) },
    document: { createElement: () => ({ click() { clicked.push({ href: this.href, name: this.download }); }, remove() {} }), body: { appendChild() {} } },
    setTimeout: fn => fn(), p: { api: async () => { if (fail) throw new Error('需要掌門權限'); return { format: 'luoyun-data-v1', events: [] }; },
      flash: (message, type) => messages.push({ message, type }) }
  });
  vm.runInContext(html.match(/    async function downloadBackup\([^]*?\n    \}/)[0], ctx);
  await ctx.downloadBackup();
  assert.deepEqual(clicked, [{ href: 'blob:backup', name: 'luoyun-backup-2026-10-15.json' }]);
  assert.deepEqual(revoked, ['blob:backup']);
  assert.equal(messages[0].type, 'ok');
  fail = true; await ctx.downloadBackup();
  assert.equal(clicked.length, 1);
  assert.deepEqual(messages[1], { message: '需要掌門權限', type: 'bad' });
  assert.deepEqual(busy, [true, false, true, false]);
});

test('門禁線性同餘公式命中全部 14 組歷史樣本，並支援 Base64 解析與偏移校正', () => {
  const swordJs = readFileSync(new URL('../public/sword-qr.js', import.meta.url), 'utf8');
  const win = { atob: s => Buffer.from(s, 'base64').toString('binary') };
  const ctx = vm.createContext({ window: win, atob: win.atob });
  vm.runInContext(swordJs, ctx);
  const sqr = win.SwordQR;

  const expected = [
    ['2026-02-23', 'QRCo16H4765210910867232'],
    ['2026-03-01', 'QRCo16H5750618259972192'],
    ['2026-03-15', 'QRCo16H2422661316803232'],
    ['2026-04-01', 'QRCo16H3408068665908192'],
    ['2026-04-15', 'QRCo16H0080111722739232'],
    ['2026-05-01', 'QRCo16H1065519071844192'],
    ['2026-05-15', 'QRCo16H7737562128675232'],
    ['2026-06-01', 'QRCo16H8722969477780192'],
    ['2026-06-15', 'QRCo16H5395012534611232'],
    ['2026-07-01', 'QRCo16H6380419883716192'],
    ['2026-07-15', 'QRCo16H3052462940547232'],
    ['2026-08-01', 'QRCo16H4037870289652192'],
    ['2026-08-17', 'QRCo16H0709913346483232'],
    ['2026-08-31', 'QRCo16H0709913346483232'],
    ['2026-09-01', 'QRCo16H1695320695588192'],
    ['2026-10-12', 'QRCo16H9352771101524192'],
    ['2026-10-26', 'QRCo16H6024814158355232']
  ];
  for (const [dateStr, code] of expected) {
    assert.equal(sqr.predictCode(dateStr).code, code, dateStr + ' 推算碼應完全吻合');
  }

  const cal = sqr.calibrateOffset('2026-10-26', 'UVJDbzE2SD    YwMjQ4MTQxNTgzNTUyMzIK    CgoKCg==');
  assert.equal(cal.code, 'QRCo16H6024814158355232');
  assert.equal(cal.isDefaultOffset, true);
  assert.equal(cal.offsetB, '2849449904504832');
  assert.equal(cal.mod160Ok, true);
  assert.equal(sqr.calibrateOffset('2027-01-01', '6180758041700192').matchedYearModel, 'YYYYMMDD');
  assert.equal(sqr.calibrateOffset('2027-01-01', '2325122319332192').matchedYearModel, '連續月份');
  assert.equal(sqr.calibrateOffset('2027-01-01', '0435717448100192').matchedYearModel, '每年重設');

  const grid = sqr.encodeQrV3H('QRCo16H6024814158355232');
  assert.equal(grid.length, 29);
  assert.equal(grid[0].length, 29);
});
