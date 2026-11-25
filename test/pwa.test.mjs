import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pwaResponse, versionedHtml } from '../pwa.mjs';

const client = readFileSync(new URL('../public/pwa.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

class Target {
  listeners = {};
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type, event = {}) { for (const callback of this.listeners[type] || []) callback(event); }
}
class Element extends Target {
  children = [];
  hidden = false;
  disabled = false;
  setAttribute() {}
  append(...children) { this.children.push(...children); }
}
async function browser() {
  const window = new Target(), document = new Target(), serviceWorker = new Target();
  const registration = new Target();
  const state = { version: 'v1', reloads: 0, safe: true, skip: 0, requests: [], fail: false };
  document.body = new Element(); document.visibilityState = 'visible';
  document.createElement = () => new Element();
  document.querySelector = () => ({ content: 'v1' });
  window.matchMedia = () => ({ matches: false });
  window.location = { reload: () => state.reloads++ };
  window.luoyunCanReload = () => state.safe;
  registration.update = async () => {};
  registration.waiting = { postMessage: message => { assert.equal(message.type, 'SKIP_WAITING'); state.skip++; } };
  serviceWorker.register = async (url, options) => { assert.equal(url, '/sw.js'); assert.equal(options.updateViaCache, 'none'); return registration; };
  const navigator = { onLine: true, serviceWorker };
  const context = vm.createContext({ window, document, navigator, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.fail) throw new Error('offline');
      if (state.pending) await state.pending;
      return { ok: true, json: async () => ({ version: state.version }) };
    }
  });
  vm.runInContext(client, context);
  await window.luoyunPwa.check();
  return { state, window, document, navigator, serviceWorker, app: window.luoyunPwa,
    notice: () => document.body.children.at(-1) };
}

test('版本與 service worker 使用同一個部署 ID，禁止快取並支援 HEAD', async () => {
  const version = 'deployed-version';
  for (const path of ['/app-version.json', '/sw.js']) {
    const response = pwaResponse(new Request('https://club.test' + path), version, sw);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.text(); assert.ok(body.includes(version)); assert.ok(!body.includes('__LUOYUN_VERSION__'));
    assert.equal(await pwaResponse(new Request('https://club.test' + path, { method: 'HEAD' }), version, sw).text(), '');
    assert.equal(pwaResponse(new Request('https://club.test' + path, { method: 'POST' }), version, sw).status, 405);
  }
  const html = versionedHtml('<meta name="app-version" content="development"><script src="/pwa.js"></script>', version);
  assert.ok(html.includes('content="deployed-version"')); assert.ok(html.includes('/pwa.js?v=deployed-version'));
  assert.equal(pwaResponse(new Request('https://club.test/api/state'), version, sw), null);
});

test('啟動、回到前景與重新連線都檢查新版，其他分頁啟用新版不會強制重整', async () => {
  const b = await browser();
  assert.ok(b.state.requests.length > 0);
  assert.ok(b.state.requests.every(r => r.options.cache === 'no-store'));
  b.state.version = 'v2';
  for (const [target, event] of [[b.window, 'pageshow'], [b.document, 'visibilitychange'], [b.window, 'online'], [b.serviceWorker, 'controllerchange']]) {
    const count = b.state.requests.length; target.emit(event); await b.app.check();
    assert.ok(b.state.requests.length > count); assert.equal(b.state.reloads, 0);
    assert.equal(b.notice().children[1].children[0].hidden, false);
  }
});

test('未儲存或儲存中的操作阻止更新，完成後才能啟用新版並重整', async () => {
  const b = await browser(); b.state.version = 'v2'; await b.app.check();
  b.state.safe = false; await b.app.applyUpdate();
  assert.equal(b.state.reloads, 0); assert.equal(b.state.skip, 0);
  assert.match(b.notice().children[0].textContent, /先儲存或關閉/);
  b.state.safe = true; await b.app.applyUpdate();
  assert.equal(b.state.skip, 1); assert.equal(b.state.reloads, 1);
});

test('版本請求等待期間開始編輯也會保留內容；離線不會重整', async () => {
  const b = await browser(); b.state.version = 'v2'; await b.app.check();
  let resolve; b.state.pending = new Promise(done => { resolve = done; });
  const applying = b.app.applyUpdate(); b.state.safe = false; resolve(); await applying;
  assert.equal(b.state.reloads, 0); assert.match(b.notice().children[0].textContent, /內容已保留/);
  b.state.pending = null; b.state.safe = true; b.state.fail = true;
  await b.app.applyUpdate(); assert.equal(b.state.reloads, 0);
  assert.match(b.notice().children[0].textContent, /無法連線/);
});

test('離線提示在恢復連線且確認版本後會解除', async () => {
  const b = await browser(); b.navigator.onLine = false;
  b.window.emit('offline'); await b.app.check();
  assert.equal(b.notice().hidden, false); assert.match(b.notice().children[0].textContent, /離線/);
  b.navigator.onLine = true; b.window.emit('online'); await b.app.check();
  assert.equal(b.notice().hidden, true); assert.equal(b.state.reloads, 0);
});

test('尚未掛上表單保護時也不可更新；安裝未支援時提供操作指引', async () => {
  const b = await browser(); b.state.version = 'v2'; await b.app.check();
  delete b.window.luoyunCanReload; await b.app.applyUpdate(); assert.equal(b.state.reloads, 0);
  await b.app.install(); assert.match(b.notice().children[0].textContent, /加入主畫面/);
});

test('主程式的更新保護涵蓋未儲存表單、開啟的視窗與正在儲存的操作', () => {
  const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const effect = html.match(/    useEffect\(function \(\) \{\r?\n      window\.luoyunCanReload[^]*?\}, \[busy, modal\]\);/)[0];
  for (const [dirty, busy, modal, allowed] of [
    [false, false, null, true], [true, false, null, false],
    [false, true, null, false], [false, false, { type: 'event' }, false]
  ]) {
    const window = {};
    vm.runInNewContext(effect, { window, unsavedRef: { current: dirty }, busy, modal, useEffect: callback => callback() });
    assert.equal(window.luoyunCanReload(), allowed);
  }
});

test('service worker 只保留離線頁與圖示，API、寫入及外站請求不攔截', async () => {
  const self = new Target(), deleted = [], cached = [], offline = { offline: true };
  self.location = { origin: 'https://club.test' }; self.clients = { claim: async () => {} };
  let skips = 0; self.skipWaiting = async () => { skips++; };
  const caches = { open: async () => ({ addAll: async urls => cached.push(...urls), match: async () => offline }),
    keys: async () => ['luoyun-offline-old', 'luoyun-offline-v2', 'other-app-cache'], delete: async key => { deleted.push(key); } };
  vm.runInContext(sw.replace('__LUOYUN_VERSION__', 'v2'), vm.createContext({ self, caches, URL, Response,
    fetch: async () => { throw new Error('offline'); } }));
  let promise; const waitUntil = p => { promise = p; };
  self.emit('install', { waitUntil }); await promise;
  assert.equal(skips, 0); assert.ok(cached.includes('/offline.html'));
  assert.ok(cached.every(url => url === '/offline.html' || url.startsWith('/icons/')));
  self.emit('activate', { waitUntil }); await promise; assert.deepEqual(deleted, ['luoyun-offline-old']);
  for (const request of [
    { url: 'https://club.test/api/state', method: 'GET', mode: 'navigate' },
    { url: 'https://club.test/api/action', method: 'POST', mode: 'cors' },
    { url: 'https://other.test/', method: 'GET', mode: 'navigate' }
  ]) {
    self.emit('fetch', { request, respondWith: () => assert.fail('不可攔截資料請求') });
  }
  self.emit('fetch', { request: { url: 'https://club.test/console.html', method: 'GET', mode: 'navigate' }, respondWith: waitUntil });
  assert.equal(await promise, offline);
  self.emit('message', { data: { type: 'SKIP_WAITING' }, waitUntil }); await promise; assert.equal(skips, 1);
});
