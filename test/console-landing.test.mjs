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

test('門禁 QR 沒有自訂圖片時會依活動日期自動顯示', () => {
  const consoleHtml = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const boardHtml = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  assert.match(consoleHtml, /var DEFAULT_GATE_QR = '\/gate-qr\.png'/);
  assert.match(consoleHtml, /function gateQrOf\(ev\)/);
  assert.match(consoleHtml, /系統已依活動日期自動產生，不需上傳/);
  assert.match(consoleHtml, /門禁 QR Code（系統自動產生）/);
  assert.match(boardHtml, /var DEFAULT_GATE_QR = '\/gate-qr\.png'/);
  assert.match(boardHtml, /src: gateQrOf\(activeEvent\)/);
});

test('羽球程度 1–10 會對應完整修為境界', () => {
  const consoleHtml = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const boardHtml = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  const landingHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(consoleHtml, /lv>=10\?'tribulation'/);
  assert.match(consoleHtml, /qi:'練氣期'.*foundation:'築基期'.*golden:'結丹期'.*nascent:'元嬰期'.*transcendent:'化神期'.*refined:'煉虛期'.*fusion:'合體期'.*mahayana:'大乘期'.*tribulation:'渡劫'/s);
  assert.match(consoleHtml, /var REALM_INFO=/);
  assert.match(consoleHtml, /var nums = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/);
  assert.match(boardHtml, /lv >= 10 \? 'tribulation'/);
  assert.match(boardHtml, /REALM_LABEL = \{.*fusion: '合體期'.*tribulation: '渡劫'/s);
  assert.match(landingHtml, /k:'tribulation',label:'渡劫'/);
});

test('修為徽章保留動態玉令視覺並覆蓋九境', () => {
  const consoleHtml = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const boardHtml = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  for (const html of [consoleHtml, boardHtml]) {
    assert.match(html, /\.level-badge::before/);
    assert.match(html, /level-realm-border/);
    for (const realm of ['qi', 'foundation', 'golden', 'nascent', 'transcendent', 'refined', 'fusion', 'mahayana', 'tribulation']) {
      assert.match(html, new RegExp(`\\.level-badge\\.realm-${realm} \\{`));
    }
  }
});

test('修為徽章 hover/focus 會提供羽球分級簡述', () => {
  const consoleHtml = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const boardHtml = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  const landingHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const html of [consoleHtml, boardHtml]) {
    assert.match(html, /level-badge-wrap/);
    assert.match(html, /羽球判讀/);
    assert.match(html, /基本球路起步/);
    assert.match(html, /進階延伸級/);
  }
  assert.match(landingHtml, /realm-badge-wrap/);
  assert.match(landingHtml, /主被動初識/);
});
