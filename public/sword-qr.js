/* ================================================================
   落雲宗・萬劍歸宗 QR 劍陣（sword-qr.js）
   ----------------------------------------------------------------
   概念參考 Reactiive 的「Cherry Blossom QR」：QR 的每個暗模組都對應
   一個實體（那邊是櫻花方塊，這裡是飛劍），立體動畫結束後回到正俯視，
   模組格位完全不變，因此仍然可以掃描。

   流程：
   1. 讀取門禁 QR 圖片 → jsQR 定位（取得版本與四角）→ 透視取樣回模組矩陣。
   2. 連續的暗模組合併成一把飛劍（橫/縱交織），三個定位角是「四劍迴旋 + 陣眼印」，
      零散單格是「劍丸」。
   3. 飛劍自外圍螺旋飛入、懸於半空成穹頂劍陣，鏡頭由斜俯角轉為正俯視，
      飛劍由中心向外依序落下成印。
   4. 靜止後只有偶爾一道流金劍光掠過；完成後會先用 jsQR 驗證「劍陣」本身
      能被解碼，失敗就回報 fallback，由頁面改顯示原圖，絕不影響入場。

   用法：var ctl = SwordQR.create(hostEl, { src, bright, onState });
         ctl.setBright(bool); ctl.replay(); ctl.destroy();
   onState('ready' | 'fallback')
   ================================================================ */
(function (root) {
  'use strict';

  var JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  var QUIET = 4;               /* QR 標準靜區 4 模組 */
  var TILT0 = 0.98;            /* 起始斜俯角（弧度，約 56°） */
  var FLY = 0.78;              /* 單把飛劍飛行秒數 */
  var DESC = 0.34;             /* 落劍秒數 */
  var FLASH = 0.32;            /* 落地劍光秒數 */
  var MAX_RUN = 7;             /* 單把飛劍最長幾格 */

  /* 所有「暗」色都壓在灰階 ~100 以下，掃碼器二值化時一定判成黑模組。 */
  var PAL = {
    paper: '#F4EEE0', paperBright: '#FFFFFF',
    bladeHi: '#1A3B32', bladeLo: '#0C201B', ridge: '#3F6E60',
    handle: '#0B1512', gold: '#7A5A1E',
    glow: 'rgba(110,232,222,0.85)', shadow: '#0A1612'
  };

  /* ---------------- 小工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function smooth(a, b, t) { var x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); }
  function lerpAngle(a, b, t) {
    var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }
  function hash(x, y, s) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* ---------------- jsQR 延遲載入 ---------------- */
  var jsqrPromise = null;
  function loadJsQR() {
    if (root.jsQR) return Promise.resolve(root.jsQR);
    if (jsqrPromise) return jsqrPromise;
    jsqrPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var timer = setTimeout(function () { reject(new Error('jsQR timeout')); }, 9000);
      s.src = JSQR_SRC;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = function () { clearTimeout(timer); root.jsQR ? resolve(root.jsQR) : reject(new Error('jsQR missing')); };
      s.onerror = function () { clearTimeout(timer); reject(new Error('jsQR load failed')); };
      document.head.appendChild(s);
    });
    jsqrPromise.catch(function () { jsqrPromise = null; });
    return jsqrPromise;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  /* ---------------- 解析：圖片 → 模組矩陣 ---------------- */
  /* 單位正方形 → 任意四邊形（Heckbert 投影映射） */
  function quadMap(p0, p1, p2, p3) {
    var x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, x3 = p3.x, y3 = p3.y;
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var a, b, c, d, e, f, g, h;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
    } else {
      var den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
      d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    }
    return function (u, v) {
      var w = g * u + h * v + 1;
      return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
    };
  }

  function sampleGrid(id, loc, dim) {
    var map = quadMap(loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner);
    var W = id.width, H = id.height, px = id.data;
    var modPx = Math.hypot(loc.topRightCorner.x - loc.topLeftCorner.x, loc.topRightCorner.y - loc.topLeftCorner.y) / dim;
    var r = clamp(Math.floor(modPx * 0.18), 0, 3);
    var n = dim * dim, lum = new Float32Array(n);
    for (var y = 0; y < dim; y++) {
      for (var x = 0; x < dim; x++) {
        var p = map((x + 0.5) / dim, (y + 0.5) / dim);
        var cx = Math.round(p[0]), cy = Math.round(p[1]), sum = 0, cnt = 0;
        for (var oy = -r; oy <= r; oy++) {
          var yy = cy + oy; if (yy < 0 || yy >= H) continue;
          for (var ox = -r; ox <= r; ox++) {
            var xx = cx + ox; if (xx < 0 || xx >= W) continue;
            var k = (yy * W + xx) * 4;
            sum += px[k] * 0.299 + px[k + 1] * 0.587 + px[k + 2] * 0.114; cnt++;
          }
        }
        lum[y * dim + x] = cnt ? sum / cnt : 255;
      }
    }
    var sorted = Array.prototype.slice.call(lum).sort(function (a, b) { return a - b; });
    var thr = (sorted[Math.floor(n * 0.05)] + sorted[Math.floor(n * 0.95)]) / 2;
    var m = new Uint8Array(n);
    for (var i = 0; i < n; i++) m[i] = lum[i] < thr ? 1 : 0;
    /* 反白 QR（亮碼暗底）：左上定位角外框應為暗 */
    if (!m[0] && !m[3 * dim + 3]) for (var j = 0; j < n; j++) m[j] ^= 1;
    return m;
  }

  function finderOk(m, dim) {
    var origins = [[0, 0], [dim - 7, 0], [0, dim - 7]];
    for (var o = 0; o < 3; o++) {
      var bad = 0;
      for (var y = 0; y < 7; y++) for (var x = 0; x < 7; x++) {
        var ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        var want = ring === 2 ? 0 : 1;
        if (m[(origins[o][1] + y) * dim + origins[o][0] + x] !== want) bad++;
      }
      if (bad > 2) return false;
    }
    return true;
  }

  var cache = {};
  var cacheKeys = [];
  function analyse(src) {
    if (cache[src]) return cache[src];
    var p = Promise.all([loadJsQR(), loadImage(src)]).then(function (res) {
      var jsQR = res[0], img = res[1];
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('empty image');
      var big = Math.max(w, h);
      var scale = big > 1000 ? 1000 / big : big < 240 ? 2 : 1;
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = makeCanvas(cw, ch);
      var x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff';
      x.fillRect(0, 0, cw, ch);           /* 透明 PNG 先墊白底 */
      x.imageSmoothingEnabled = scale < 1;
      x.drawImage(img, 0, 0, cw, ch);
      var id = x.getImageData(0, 0, cw, ch);
      var out = jsQR(id.data, cw, ch, { inversionAttempts: 'attemptBoth' });
      if (!out || !out.version || !out.location) throw new Error('decode failed');
      var dim = 17 + 4 * out.version;
      var m = sampleGrid(id, out.location, dim);
      if (!finderOk(m, dim)) throw new Error('grid sampling failed');
      return { dim: dim, m: m, data: out.data, jsQR: jsQR };
    });
    cache[src] = p;
    cacheKeys.push(src);
    if (cacheKeys.length > 6) delete cache[cacheKeys.shift()];
    p.catch(function () { if (cache[src] === p) delete cache[src]; });
    return p;
  }

  /* ---------------- 佈陣：矩陣 → 飛劍 ---------------- */
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];

  function swordPiece(hx, hy, dir, L) {
    var d = DIRS[dir];
    return { kind: L > 1 ? 'sword' : 'pellet', L: L, W: 1, dir: dir, th: dir * Math.PI / 2,
      gx: hx + 0.5 + d[0] * (L - 1) / 2, gy: hy + 0.5 + d[1] * (L - 1) / 2 };
  }

  function buildPieces(m, dim) {
    var used = new Uint8Array(dim * dim), pieces = [];
    function dark(x, y) { return x >= 0 && y >= 0 && x < dim && y < dim && m[y * dim + x] && !used[y * dim + x]; }
    function take(x, y) { used[y * dim + x] = 1; }

    /* 三個定位角：外框四劍迴旋（劍尖接劍柄），中心 3×3 為陣眼印 */
    [[0, 0], [dim - 7, 0], [0, dim - 7]].forEach(function (o) {
      var fx = o[0], fy = o[1];
      pieces.push(swordPiece(fx, fy, 0, 6));
      pieces.push(swordPiece(fx + 6, fy, 1, 6));
      pieces.push(swordPiece(fx + 6, fy + 6, 2, 6));
      pieces.push(swordPiece(fx, fy + 6, 3, 6));
      pieces.push({ kind: 'seal', L: 3, W: 3, dir: 0, th: 0, gx: fx + 3.5, gy: fy + 3.5, finder: true });
      for (var y = 0; y < 7; y++) for (var x = 0; x < 7; x++) {
        var ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        if (ring !== 2) take(fx + x, fy + y);
      }
    });

    /* 其餘暗模組：貪婪取最長的橫/縱連續段，交織成劍網 */
    for (var y = 0; y < dim; y++) {
      for (var x = 0; x < dim; x++) {
        if (!dark(x, y)) continue;
        var h = 0, v = 0;
        while (h < MAX_RUN && dark(x + h, y)) h++;
        while (v < MAX_RUN && dark(x, y + v)) v++;
        var horiz = h > v || (h === v && hash(x, y, 1) < 0.5);
        var L = horiz ? h : v;
        if (L < 2) { take(x, y); pieces.push(swordPiece(x, y, 0, 1)); continue; }
        for (var k = 0; k < L; k++) horiz ? take(x + k, y) : take(x, y + k);
        var flip = hash(x, y, 2) < 0.5;
        if (horiz) pieces.push(flip ? swordPiece(x + L - 1, y, 2, L) : swordPiece(x, y, 0, L));
        else pieces.push(flip ? swordPiece(x, y + L - 1, 3, L) : swordPiece(x, y, 1, L));
      }
    }

    /* 飛行參數 */
    var rmax = dim * 0.72, end = 0;
    pieces.forEach(function (p, i) {
      var wx = p.gx - dim / 2, wy = p.gy - dim / 2;
      var r = Math.hypot(wx, wy), ang = Math.atan2(wy, wx);
      var rnd = hash(i, 7, 3), rnd2 = hash(i, 11, 5), rnd3 = hash(i, 13, 9);
      p.wx = wx; p.wy = wy; p.rn = clamp01(r / rmax);
      p.delay = 0.55 * (((ang + Math.PI) / (Math.PI * 2) + rnd * 0.12) % 1);
      var phi = ang - 1.25 - rnd2 * 0.5, R = dim * (0.95 + rnd3 * 0.35);
      p.sx = R * Math.cos(phi); p.sy = R * Math.sin(phi); p.sz = 7 + rnd * 7;
      var phm = (phi + ang) / 2 + 0.2, Rc = (R + r) * 0.62;
      p.cx = Rc * Math.cos(phm); p.cy = Rc * Math.sin(phm); p.cz = p.sz + 2;
      p.hz = 1.2 + 6 * Math.max(0, 1 - p.rn * p.rn) + rnd2 * 0.8 + (p.finder ? 1.2 : 0);
      p.bob = rnd3 * Math.PI * 2;
      p.tD = Math.max(1.25 + 0.45 * p.rn + rnd * 0.08, p.delay + FLY + 0.05);
      end = Math.max(end, p.tD + DESC + FLASH);
    });
    pieces.end = end;
    return pieces;
  }

  /* ---------------- 繪製：單件（區域座標，單位＝模組） ---------------- */
  function drawSword(c, L) {
    var a = -L / 2, b = L / 2, tb = b - 0.52;
    c.fillStyle = PAL.bladeHi;
    c.beginPath(); c.moveTo(a + 0.78, -0.40); c.lineTo(tb, -0.40); c.lineTo(b - 0.04, 0); c.lineTo(a + 0.78, 0); c.closePath(); c.fill();
    c.fillStyle = PAL.bladeLo;
    c.beginPath(); c.moveTo(a + 0.78, 0); c.lineTo(b - 0.04, 0); c.lineTo(tb, 0.40); c.lineTo(a + 0.78, 0.40); c.closePath(); c.fill();
    c.strokeStyle = PAL.ridge; c.lineWidth = 0.05; c.lineCap = 'round';
    c.beginPath(); c.moveTo(a + 0.92, 0); c.lineTo(b - 0.18, 0); c.stroke();
    /* 劍柄、纏繩、劍首 */
    c.fillStyle = PAL.handle; rr(c, a + 0.06, -0.25, 0.6, 0.5, 0.1); c.fill();
    c.strokeStyle = PAL.gold; c.lineWidth = 0.045;
    c.beginPath();
    c.moveTo(a + 0.30, -0.25); c.lineTo(a + 0.24, 0.25);
    c.moveTo(a + 0.42, -0.25); c.lineTo(a + 0.36, 0.25);
    c.moveTo(a + 0.54, -0.25); c.lineTo(a + 0.48, 0.25);
    c.stroke();
    c.fillStyle = PAL.gold;
    c.beginPath(); c.arc(a + 0.12, 0, 0.1, 0, Math.PI * 2); c.fill();
    /* 劍格（護手） */
    c.beginPath(); c.moveTo(a + 0.62, -0.47); c.lineTo(a + 0.82, -0.36); c.lineTo(a + 0.82, 0.36); c.lineTo(a + 0.62, 0.47);
    c.quadraticCurveTo(a + 0.71, 0, a + 0.62, -0.47); c.fill();
  }
  function drawPellet(c) {
    c.fillStyle = PAL.bladeLo; rr(c, -0.43, -0.43, 0.86, 0.86, 0.24); c.fill();
    c.strokeStyle = PAL.gold; c.lineWidth = 0.06; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(0, -0.22); c.lineTo(0.22, 0); c.lineTo(0, 0.22); c.lineTo(-0.22, 0); c.closePath(); c.stroke();
  }
  function drawSeal(c) {
    c.fillStyle = PAL.bladeLo; rr(c, -1.45, -1.45, 2.9, 2.9, 0.38); c.fill();
    c.strokeStyle = PAL.gold; c.lineWidth = 0.07; rr(c, -1.18, -1.18, 2.36, 2.36, 0.22); c.stroke();
    /* 陣眼劍紋：一柄直立小劍 */
    c.fillStyle = PAL.ridge;
    c.beginPath(); c.moveTo(0, -0.92); c.lineTo(0.13, -0.68); c.lineTo(0.13, 0.4); c.lineTo(-0.13, 0.4); c.lineTo(-0.13, -0.68); c.closePath(); c.fill();
    c.fillStyle = PAL.gold;
    rr(c, -0.4, 0.4, 0.8, 0.13, 0.05); c.fill();
    rr(c, -0.07, 0.53, 0.14, 0.34, 0.05); c.fill();
  }
  function drawBody(c, p) {
    if (p.kind === 'sword') drawSword(c, p.L);
    else if (p.kind === 'seal') drawSeal(c);
    else drawPellet(c);
  }
  function silhouette(c, p) {
    if (p.kind === 'seal') { rr(c, -1.45, -1.45, 2.9, 2.9, 0.38); return; }
    if (p.kind === 'pellet') { rr(c, -0.43, -0.43, 0.86, 0.86, 0.24); return; }
    var a = -p.L / 2, b = p.L / 2;
    c.beginPath();
    c.moveTo(a + 0.06, -0.25); c.lineTo(a + 0.62, -0.25); c.lineTo(a + 0.62, -0.47); c.lineTo(a + 0.82, -0.40);
    c.lineTo(b - 0.52, -0.40); c.lineTo(b - 0.04, 0); c.lineTo(b - 0.52, 0.40); c.lineTo(a + 0.82, 0.40);
    c.lineTo(a + 0.62, 0.47); c.lineTo(a + 0.62, 0.25); c.lineTo(a + 0.06, 0.25); c.closePath();
  }

  /* 靜止劍陣（正俯視、向量繪製，最清晰） */
  function renderFlat(c, pieces, S, k, ox, oy) {
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i], co = COS[p.dir], si = SIN[p.dir];
      c.setTransform(co * S * k, si * S * k, -si * S * k, co * S * k, (ox + p.gx * S) * k, (oy + p.gy * S) * k);
      drawBody(c, p);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* 驗證：把劍陣本身畫出來再解碼一次，確保真的掃得到 */
  function verifyRender(model, pieces) {
    var S = 6, dim = model.dim, size = (dim + QUIET * 2) * S;
    var c = makeCanvas(size, size), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = PAL.paper; x.fillRect(0, 0, size, size);
    renderFlat(x, pieces, S, 1, QUIET * S - 0, QUIET * S - 0);
    var id = x.getImageData(0, 0, size, size);
    var out = model.jsQR(id.data, size, size, { inversionAttempts: 'dontInvert' });
    return !!out && out.data === model.data;
  }

  /* ---------------- 控制器 ---------------- */
  function create(host, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    canvas.className = 'sword-qr-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '門禁 QR Code（飛劍劍陣）');
    canvas.title = '輕觸：略過／重新召劍';
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var mq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var st = {
      dead: false, model: null, pieces: null, size: 0, dpr: 1, S: 1,
      bright: !!opts.bright, phase: 'idle', raf: 0, t0: 0, sheenTimer: 0,
      sprites: null, layer: null, scratch: null, bg: null, buf: null
    };

    function emit(s, e) { if (opts.onState) try { opts.onState(s, e); } catch (_) { /* ignore */ } }
    function reduced() { return !!(mq && mq.matches); }

    /* ----- 依尺寸建立快取：sprite、靜止劍陣圖層 ----- */
    function layout() {
      if (st.dead || !st.model) return;
      var size = Math.round(host.clientWidth || host.getBoundingClientRect().width || 260);
      var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      if (size === st.size && dpr === st.dpr && st.sprites) return;
      st.size = size; st.dpr = dpr;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      st.S = size / (st.model.dim + QUIET * 2);
      buildSprites();
      st.layer = makeCanvas(canvas.width, canvas.height);
      renderFlat(st.layer.getContext('2d'), st.pieces, st.S, dpr, QUIET * st.S, QUIET * st.S);
      st.scratch = makeCanvas(canvas.width, canvas.height);
      var g = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.05, size / 2, size / 2, size * 0.75);
      g.addColorStop(0, '#1B2E29'); g.addColorStop(1, '#08110F');
      st.bg = g;
      if (st.phase === 'rest') drawRest(-1);
    }

    function buildSprites() {
      var P = clamp(Math.round(st.S * st.dpr * 1.6), 12, 56), pad = 0.6;
      var map = {};
      function make(p, variant) {
        var Lw = p.L, Lh = p.W, w = (Lw + pad * 2) * P, h = (Lh + pad * 2) * P;
        var c = makeCanvas(w, h), x = c.getContext('2d');
        x.setTransform(P, 0, 0, P, w / 2, h / 2);
        if (variant === 'body') drawBody(x, p);
        else if (variant === 'shadow') { silhouette(x, p); x.fillStyle = PAL.shadow; x.fill(); }
        else {
          x.shadowColor = PAL.glow; x.shadowBlur = P * 0.45;
          silhouette(x, p); x.fillStyle = 'rgba(150,240,232,0.55)'; x.fill();
        }
        return { c: c, x0: -(Lw / 2 + pad), y0: -(Lh / 2 + pad), w: Lw + pad * 2, h: Lh + pad * 2 };
      }
      st.pieces.forEach(function (p) {
        var key = p.kind + p.L;
        if (!map[key]) map[key] = { body: make(p, 'body'), shadow: make(p, 'shadow'), glow: make(p, 'glow') };
        p.spr = map[key];
      });
      var tr = makeCanvas(64, 8), tx = tr.getContext('2d');
      var g = tx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(150,240,232,0)'); g.addColorStop(1, 'rgba(170,245,236,0.75)');
      tx.fillStyle = g; tx.fillRect(0, 0, 64, 8);
      st.trail = tr;
      st.sprites = map;
      var n = st.pieces.length;
      st.buf = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), a: new Float32Array(n),
        al: new Float32Array(n), gl: new Float32Array(n), tl: new Float32Array(n), d: new Float32Array(n), order: [] };
    }

    /* ----- 動畫影格 ----- */
    var P1 = [0, 0, 0], P2 = [0, 0, 0], P3 = [0, 0, 0];
    function drawFrame(t) {
      var size = st.size, dpr = st.dpr, dim = st.model.dim, pieces = st.pieces, B = st.buf;
      var tiltK = 1 - easeInOutCubic(clamp01((t - 0.95) / 1.15));
      var tilt = TILT0 * tiltK, yaw = -0.5 * (1 - easeInOutCubic(clamp01(t / 2.1)));
      var S = st.S * (1 - 0.26 * tiltK);
      var ct = Math.cos(tilt), sn = Math.sin(tilt), cyw = Math.cos(yaw), syw = Math.sin(yaw);
      var F = dim * 2.4, cx = size / 2, cy = size / 2 + S * sn * 3.4;
      function proj(x, y, z, o) {
        var xr = x * cyw - y * syw, yr = x * syw + y * cyw;
        var Y = yr * ct - z * sn, D = yr * sn + z * ct, f = F / Math.max(F - D, 1);
        o[0] = cx + xr * f * S; o[1] = cy + Y * f * S; o[2] = D;
      }
      function place(x, y, z, a) {
        var ux = Math.cos(a) * 0.5, uy = Math.sin(a) * 0.5;
        proj(x + ux, y + uy, z, P1); proj(x - ux, y - uy, z, P2);
        var A = P1[0] - P2[0], Bb = P1[1] - P2[1];
        proj(x - uy, y + ux, z, P1); proj(x + uy, y - ux, z, P3);
        var C = P1[0] - P3[0], D = P1[1] - P3[1];
        proj(x, y, z, P1);
        ctx.setTransform(A * dpr, Bb * dpr, C * dpr, D * dpr, P1[0] * dpr, P1[1] * dpr);
      }
      function sprite(s) { ctx.drawImage(s.c, s.x0, s.y0, s.w, s.h); }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = st.bright ? '#FFFFFF' : st.bg;
      ctx.fillRect(0, 0, size, size);

      /* 地面：宣紙陣盤 */
      var hs = dim / 2 + QUIET;
      ctx.beginPath();
      proj(-hs, -hs, 0, P1); ctx.moveTo(P1[0], P1[1]);
      proj(hs, -hs, 0, P1); ctx.lineTo(P1[0], P1[1]);
      proj(hs, hs, 0, P1); ctx.lineTo(P1[0], P1[1]);
      proj(-hs, hs, 0, P1); ctx.lineTo(P1[0], P1[1]);
      ctx.closePath();
      ctx.fillStyle = st.bright ? PAL.paperBright : PAL.paper;
      ctx.fill();

      /* 陣紋：雙環＋旋轉刻度，劍落後淡出 */
      var rune = 1 - smooth(1.5, 2.3, t);
      if (rune > 0.01) {
        var r1 = dim * 0.5 + 1.6, r2 = r1 + 0.9, seg = 72, i, ang;
        ctx.globalAlpha = rune;
        ctx.strokeStyle = 'rgba(140,101,28,0.55)'; ctx.lineWidth = 1.2;
        [r1, r2].forEach(function (r) {
          ctx.beginPath();
          for (i = 0; i <= seg; i++) {
            ang = i / seg * Math.PI * 2; proj(r * Math.cos(ang), r * Math.sin(ang), 0, P1);
            i ? ctx.lineTo(P1[0], P1[1]) : ctx.moveTo(P1[0], P1[1]);
          }
          ctx.stroke();
        });
        ctx.beginPath();
        for (i = 0; i < 36; i++) {
          ang = i / 36 * Math.PI * 2 + t * 0.6;
          var r3 = i % 3 ? r1 + 0.25 : r1 + 0.05;
          proj(r3 * Math.cos(ang), r3 * Math.sin(ang), 0, P1); ctx.moveTo(P1[0], P1[1]);
          proj((r2 - 0.1) * Math.cos(ang), (r2 - 0.1) * Math.sin(ang), 0, P1); ctx.lineTo(P1[0], P1[1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* 計算每把飛劍的位置 */
      var order = B.order; order.length = 0;
      for (var k = 0; k < pieces.length; k++) {
        var p = pieces[k];
        if (t < p.delay) { B.al[k] = 0; continue; }
        var s0 = clamp01((t - p.delay) / FLY), s = easeOutCubic(s0);
        var q = clamp01((t - p.tD) / DESC);
        var lift = (p.hz + 0.25 * Math.sin(2.4 * t + p.bob)) * (1 - Math.pow(q, 2.6));
        var x, y, z, a, speed = 0;
        if (s0 < 1) {
          var u = 1 - s;
          x = u * u * p.sx + 2 * u * s * p.cx + s * s * p.wx;
          y = u * u * p.sy + 2 * u * s * p.cy + s * s * p.wy;
          z = u * u * p.sz + 2 * u * s * p.cz + s * s * lift;
          var tx = 2 * u * (p.cx - p.sx) + 2 * s * (p.wx - p.cx);
          var ty = 2 * u * (p.cy - p.sy) + 2 * s * (p.wy - p.cy);
          var ds = 3 * (1 - s0) * (1 - s0) / FLY;
          speed = Math.hypot(tx, ty) * ds;
          a = lerpAngle(Math.atan2(ty, tx), p.th, smooth(0.5, 1, s0));
        } else { x = p.wx; y = p.wy; z = lift; a = p.th; }
        var landed = t - (p.tD + DESC);
        B.x[k] = x; B.y[k] = y; B.z[k] = z; B.a[k] = a;
        B.al[k] = Math.min(1, s0 / 0.12);
        B.gl[k] = (q < 1 ? 0.5 * (1 - q) : 0) + (landed > 0 && landed < FLASH ? 0.9 * (1 - landed / FLASH) : 0);
        B.tl[k] = clamp(speed * 0.05, 0, 5);
        B.d[k] = (x * syw + y * cyw) * sn + z * ct;
        order.push(k);
      }

      /* 影子（地面） */
      for (var m = 0; m < order.length; m++) {
        var j = order[m];
        if (B.z[j] < 0.03) continue;
        ctx.globalAlpha = B.al[j] * 0.3 * clamp01(1 - B.z[j] / 16);
        place(B.x[j], B.y[j], 0, B.a[j]);
        sprite(pieces[j].spr.shadow);
      }

      /* 由遠到近畫飛劍 */
      order.sort(function (i1, i2) { return B.d[i1] - B.d[i2]; });
      for (var n = 0; n < order.length; n++) {
        var i3 = order[n], pc = pieces[i3];
        place(B.x[i3], B.y[i3], B.z[i3], B.a[i3]);
        if (B.tl[i3] > 0.15) {
          ctx.globalAlpha = B.al[i3] * 0.7;
          ctx.drawImage(st.trail, -pc.L / 2 - B.tl[i3], -0.12, B.tl[i3], 0.24);
        }
        if (B.gl[i3] > 0.02) { ctx.globalAlpha = B.al[i3] * B.gl[i3]; sprite(pc.spr.glow); }
        ctx.globalAlpha = B.al[i3];
        sprite(pc.spr.body);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ----- 靜止畫面＋流金劍光 ----- */
    function drawRest(p) {
      var W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = st.bright ? PAL.paperBright : PAL.paper;
      ctx.fillRect(0, 0, W, H);
      if (!st.bright) {
        /* 靜區外緣一圈淡金符框，距碼 3 模組以上，不影響辨識 */
        var inset = st.S * 0.7 * st.dpr;
        ctx.strokeStyle = 'rgba(201,169,97,0.38)'; ctx.lineWidth = Math.max(1, st.dpr);
        ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      }
      if (p < 0 || p >= 1) { ctx.drawImage(st.layer, 0, 0); return; }
      var sc = st.scratch.getContext('2d');
      sc.globalCompositeOperation = 'copy';
      sc.drawImage(st.layer, 0, 0);
      sc.globalCompositeOperation = 'source-atop';
      var pos = -0.35 + 1.7 * easeInOutCubic(p), band = 0.22;
      var g = sc.createLinearGradient(0, 0, W, H);
      g.addColorStop(clamp01(pos - band), 'rgba(214,186,120,0)');
      g.addColorStop(clamp01(pos), 'rgba(222,196,128,0.24)');
      g.addColorStop(clamp01(pos + band), 'rgba(214,186,120,0)');
      sc.fillStyle = g; sc.fillRect(0, 0, W, H);
      sc.globalCompositeOperation = 'source-over';
      ctx.drawImage(st.scratch, 0, 0);
    }

    function stopLoops() {
      if (st.raf) cancelAnimationFrame(st.raf);
      if (st.sheenTimer) clearTimeout(st.sheenTimer);
      st.raf = 0; st.sheenTimer = 0;
    }

    function scheduleSheen(delay) {
      if (st.dead || st.bright || reduced()) return;
      st.sheenTimer = setTimeout(function () {
        st.sheenTimer = 0;
        if (st.dead || st.phase !== 'rest') return;
        if (document.hidden) return scheduleSheen(2000);
        var start = performance.now();
        (function step(now) {
          if (st.dead || st.phase !== 'rest') return;
          var p = (now - start) / 1100;
          drawRest(p);
          if (p < 1) st.raf = requestAnimationFrame(step);
          else { st.raf = 0; scheduleSheen(4800); }
        })(start);
      }, delay);
    }

    function toRest() {
      stopLoops();
      st.phase = 'rest';
      drawRest(-1);
      scheduleSheen(1400);
    }

    function play() {
      stopLoops();
      if (reduced() || st.bright) return toRest();
      st.phase = 'anim';
      st.t0 = performance.now();
      (function loop(now) {
        if (st.dead) return;
        var t = (now - st.t0) / 1000;
        if (t >= st.pieces.end) return toRest();
        drawFrame(t);
        st.raf = requestAnimationFrame(loop);
      })(st.t0);
    }

    function onTap() {
      if (!st.model) return;
      if (st.phase === 'anim') toRest(); else play();
    }
    canvas.addEventListener('click', onTap);

    var ro = null, roPending = 0;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(function () {
        if (roPending) return;
        roPending = requestAnimationFrame(function () { roPending = 0; layout(); });
      });
      ro.observe(host);
    }

    analyse(opts.src).then(function (model) {
      if (st.dead) return;
      var pieces = buildPieces(model.m, model.dim);
      if (!verifyRender(model, pieces)) throw new Error('sword render not scannable');
      st.model = model; st.pieces = pieces;
      layout();
      emit('ready');
      if (typeof opts.debugTime === 'number') {
        if (opts.debugTime >= pieces.end) { st.phase = 'rest'; drawRest(opts.debugRest == null ? -1 : opts.debugRest); }
        else drawFrame(opts.debugTime);
        return;
      }
      play();
    }).catch(function (err) {
      if (!st.dead) emit('fallback', err);
    });

    return {
      setBright: function (b) {
        b = !!b;
        if (b === st.bright) return;
        st.bright = b;
        if (!st.model) return;
        if (b) toRest();                 /* 增亮＝立即定格、停掉劍光，專心掃碼 */
        else if (st.phase === 'rest') { stopLoops(); drawRest(-1); scheduleSheen(1400); }
      },
      replay: function () { if (st.model) play(); },
      destroy: function () {
        st.dead = true;
        stopLoops();
        if (roPending) cancelAnimationFrame(roPending);
        if (ro) ro.disconnect();
        canvas.removeEventListener('click', onTap);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  /* 預熱：頁面閒置時先載 jsQR 並解析，打開彈窗即可立刻起陣 */
  function prefetch(src) {
    if (!src) return;
    var run = function () { analyse(src).catch(function () { /* 開彈窗時再處理 */ }); };
    if (root.requestIdleCallback) root.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500);
  }

  root.SwordQR = { create: create, prefetch: prefetch, analyse: analyse };
})(typeof window !== 'undefined' ? window : this);
