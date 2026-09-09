import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('cultivation ranks are deterministic and reward confirmed enrollment', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const window = {};
  const document = {
    readyState: 'loading',
    querySelector: () => null,
    addEventListener: () => {},
    getElementById: () => ({ textContent: '{}', innerHTML: '' })
  };
  vm.runInNewContext(scripts.at(-1)[1], { window, document, navigator:{}, location:{ href:'https://example.test/' },
    Intl, Date, Math, Object, String, Number, Array, setTimeout:() => 0, AbortSignal });
  const { activityOf, titleOf, hashOf } = window.__luoyunCultivation;
  const list = activityOf([{ roster:[
    { nickname:'流雲', gender:'female', level:5, status:'maybe' },
    { nickname:'凌風', gender:'male', level:4, status:'going' }
  ] }, { roster:[
    { nickname:'流雲', gender:'female', level:6, status:'going' },
    { nickname:'凌風', gender:'male', level:4, status:'going' }
  ] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(list)), [
    { nickname:'凌風', level:4, going:2, score:200 },
    { nickname:'流雲', level:6, going:1, score:130 }
  ]);
  assert.equal(titleOf(1), '初入雲門');
  assert.equal(titleOf(2), '凝氣弟子');
  assert.equal(titleOf(8), '雲巔真人');
  assert.equal(hashOf('2026-09-09'), hashOf('2026-09-09'));
});
