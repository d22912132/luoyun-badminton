import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('  function canvasRoundRect('), html.indexOf('  function DharmaCardModal('));
function renderer() {
  const calls = [];
  const ctx = new Proxy({ font: '14px sans-serif', textAlign: 'center',
    measureText(text) { return { width: Array.from(String(text)).length * Number(this.font.match(/(\d+)px/)[1]) }; },
    fillText(text, x, y) { calls.push({ text, x, y, width: this.measureText(text).width, align: this.textAlign }); },
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  class Clock extends Date { constructor() { super('2026-11-24T16:30:00Z'); } }
  const scope = vm.createContext({ Intl, Date: Clock }); vm.runInContext(source, scope);
  return { calls, ctx, scope };
}

test('九境小卡與極長名稱都維持文字邊界，日期使用台灣時間', () => {
  for (const realmKey of ['qi','foundation','golden','nascent','transcendent','refined','fusion','mahayana','tribulation']) {
    const r = renderer();
    r.scope.drawDharmaCard({ width: 720, height: 1080, getContext: () => r.ctx }, {
      name: '超長道號驗證'.repeat(20), realmKey, realmName: '渡劫', level: 10, guideRange: '10',
      rank: { name: '長職司稱號'.repeat(20), glyph: '羽' }, mood: '心境'.repeat(100),
      lore: '宗門判詞'.repeat(100), guideText: '羽球程度判讀'.repeat(100)
    });
    for (const call of r.calls) {
      const left = call.align === 'center' ? call.x - call.width / 2 : call.x;
      assert.ok(left >= 40, call.text); assert.ok(left + call.width <= 680, call.text);
      assert.ok(call.y > 40 && call.y <= 1040);
    }
    assert.ok(r.calls.some(c => c.text.includes('2026.11.25')));
    assert.ok(r.calls.some(c => c.text.endsWith('…')));
  }
});

test('段落換行限制行數，保留明確省略符號', () => {
  const r = renderer(); r.ctx.font = '20px sans-serif';
  const lines = r.scope.dharmaTextLines(r.ctx, '甲乙丙丁戊己庚辛壬癸', 80, 2);
  assert.equal(lines.length, 2); assert.equal(lines[1].endsWith('…'), true);
  assert.ok(lines.every(line => r.ctx.measureText(line).width <= 80));
});

function cardModal(blob) {
  const flashes = [], anchors = [], revoked = [];
  const modalSource = html.slice(html.indexOf('  function DharmaCardModal('), html.indexOf('  /* ---------------- modals ---------------- */'));
  const scope = vm.createContext({
    useRef: () => ({ current: { toBlob: callback => callback(blob) } }),
    useState: () => [false, () => {}], useEffect() {},
    resolveDharmaProfile: () => ({ name: '道/友', realmName: '合體期', level: 8 }),
    E: (type, props, ...children) => ({ type, props, children }), D() {}, S() {}, T3: '', Modal: 'modal', Btn: 'button',
    URL: { createObjectURL: () => 'blob:card', revokeObjectURL: url => revoked.push(url) },
    document: { createElement: () => ({ click() { anchors.push(this); } }), body: { appendChild() {}, removeChild() {} } },
    setTimeout: callback => callback()
  });
  vm.runInContext(modalSource, scope);
  const modal = scope.DharmaCardModal({ flash: (...args) => flashes.push(args) });
  return { download: modal.props.footer.find(button => button.props.key === 'dl').props.onClick, flashes, anchors, revoked };
}

test('PNG 匯出使用 Blob 並清理網址，檔名移除路徑字元', async () => {
  const card = cardModal({ type: 'image/png' }); await card.download();
  assert.equal(card.anchors[0].download, '落雲宗道照-道_友.png');
  assert.equal(card.anchors[0].href, 'blob:card');
  assert.deepEqual(card.revoked, ['blob:card']); assert.equal(card.flashes[0][1], 'ok');
});

test('PNG 產生失敗不建立下載連結並顯示錯誤', async () => {
  const card = cardModal(null); await card.download();
  assert.equal(card.anchors.length, 0); assert.equal(card.flashes[0][1], 'bad');
});
