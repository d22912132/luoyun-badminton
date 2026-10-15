import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';

test('暫停的排位頁與舊活動書籤一律導回試煉佈告', async t => {
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

  for (const path of ['/board.html', '/court.html', '/board.html?event=old&view=tablet', '/court.html?event=old']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(base + path, { method, redirect: 'manual' });
      assert.equal(res.status, 307, method + ' ' + path);
      assert.equal(res.headers.get('location'), '/console.html');
      assert.equal(await res.text(), '');
    }
  }
});
