import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('console landing effect restores the full rite after the first console paint', () => {
  const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  assert.match(html, /className:'console-rite-frame'/);
  assert.match(html, /src:'\/rite\.html\?rite=1&embedded=1'/);
  assert.match(html, /landingPlayed\.current = true; requestAnimationFrame/);
  assert.match(html, /window\.addEventListener\('message', onRiteDone\)/);
});
