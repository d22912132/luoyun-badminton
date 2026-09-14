import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('console preloads the full rite and starts it only after its ready signal', () => {
  const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  assert.match(html, /className:'console-rite-frame'/);
  assert.match(html, /src:'\/rite\.html\?rite=1&embedded=1&hold=1'/);
  assert.match(html, /ev\.data\.rite === 'ready'/);
  assert.match(html, /rite:'start'/);
  assert.match(html, /\}, 2500\)/);
  assert.match(html, /window\.addEventListener\('message', onRiteDone\)/);
});
