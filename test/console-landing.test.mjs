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

test('內建門禁 QR 只在當月有效，過月就不給圖', () => {
  const consoleHtml = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const boardHtml = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  const MONTH_KEY = "var DEFAULT_GATE_QR_MONTH = '";

  for (const [name, html] of [['console.html', consoleHtml], ['board.html', boardHtml]]) {
    assert.ok(html.includes("var DEFAULT_GATE_QR = '/gate-qr.png'"), name + ' 要有內建門禁圖');
    assert.ok(html.includes('function gateQrOf(ev)'), name + ' 要有 gateQrOf');
    // 球館每月換碼；少了月份守門，過期的碼會被當成有效的發出去
    assert.ok(html.includes('function defaultGateQrFresh(ev)'), name + ' 要有月份守門');
    assert.ok(html.includes("return defaultGateQrFresh(ev) ? DEFAULT_GATE_QR : '';"),
      name + ' 要先問過月份才可以退回內建圖');
    assert.ok(!html.includes('return ev.gateQr || DEFAULT_GATE_QR;'),
      name + ' 不可以略過月份判斷直接退回內建圖');
  }

  const monthOf = html => html.split(MONTH_KEY)[1].slice(0, 7);
  const consoleMonth = monthOf(consoleHtml);
  assert.equal(consoleMonth.length, 7, 'DEFAULT_GATE_QR_MONTH 應為 YYYY-MM');
  assert.equal(consoleMonth.charAt(4), '-', 'DEFAULT_GATE_QR_MONTH 應為 YYYY-MM');
  assert.equal(monthOf(boardHtml), consoleMonth,
    '兩頁的門禁碼月份必須一致，否則只會有一邊顯示');

  assert.ok(boardHtml.includes('src: gateQrOf(activeEvent)'), 'board 仍以 gateQrOf 取圖');

  // 文案不要再寫成「依活動日期自動產生」——碼是球館每月發的，不是算出來的
  assert.ok(!consoleHtml.includes('系統已依活動日期自動產生'), '舊的誤導文案應已移除');
  assert.ok(consoleHtml.includes('月公用門禁碼，不需上傳'), '說明要標出是哪個月的公用碼');
  assert.ok(consoleHtml.includes('門禁 QR Code（系統內建公用碼・'), '表單標題要標出月份');
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
