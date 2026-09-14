import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .match(/<script id="rite-js">([\s\S]*?)<\/script>/)[1];

test('skipping the curtain before its first frame cancels startup and reports completion once', () => {
  const classes = new Set(), frames = [], timers = new Map(), listeners = {}, messages = [];
  let nextTimer = 0, removed = 0, geometryReads = 0;
  const root = { classList: { contains: () => true, remove() {} } };
  const rite = {
    classList: { contains: key => classes.has(key), add: key => classes.add(key) },
    parentNode: { removeChild() { removed++; } },
    querySelector: () => ({ querySelector() {} }),
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getBoundingClientRect() { geometryReads++; throw new Error('Dismissed curtain must not build geometry'); }
  };
  const window = {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    addEventListener() {},
    parent: { postMessage: message => messages.push(message) }
  };
  runInNewContext(script, {
    window, document: { documentElement: root, getElementById: () => rite, readyState: 'complete' },
    location: { search: '', origin: 'http://localhost' },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => frames.push(fn),
    clearTimeout: id => timers.delete(id), clearInterval() {},
    sessionStorage: { setItem() {} }
  });
  listeners.click();
  listeners.click();
  while (frames.length) frames.shift()();
  for (const [id, fn] of timers) { timers.delete(id); fn(); }
  assert.equal(removed, 1);
  assert.equal(geometryReads, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].rite, 'done');
});
