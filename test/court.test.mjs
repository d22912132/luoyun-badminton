import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';

// 新增 html 頁面必須同時註冊本機 handler 與 worker 的 pages map，
// 漏一處會變成「本機能開、正式站 404」或反之，而且不會有任何錯誤訊息。
test('court.html is served locally and registered for the Cloudflare worker', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'luoyun-court-test-'));
  const app = createApp({ dataDir: directory, setupToken: 'test-setup-token' });
  await new Promise(done => app.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.address().port;
  t.after(async () => {
    await new Promise(done => app.close(done));
    const actual = realpathSync(directory);
    assert.ok(actual.startsWith(resolve(tmpdir()) + '\\luoyun-court-test-') || actual.startsWith(resolve(tmpdir()) + '/luoyun-court-test-'));
    rmSync(actual, { recursive: true });
  });

  const res = await fetch(base + '/court.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /name="club-live"/);

  const worker = readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /import courtHtml from '\.\/court\.html'/);
  assert.match(worker, /'\/court\.html': courtHtml/);
});
