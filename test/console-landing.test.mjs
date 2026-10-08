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
