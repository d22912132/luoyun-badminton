import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('console landing effect stays native and does not load the heavyweight rite page', () => {
  const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  assert.match(html, /function LandingRite\(p\)/);
  assert.match(html, /setTimeout\(p\.onSkip, 820\)/);
  assert.match(html, /landingPlayed\.current = true; invokeFx\('landing'\)/);
  assert.doesNotMatch(html, /console-rite-frame|src: '\/rite\.html\?rite=1/);
});
