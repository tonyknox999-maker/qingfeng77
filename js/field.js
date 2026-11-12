/* ============================================================
   微光场 · 清风77 粒子引擎
   一个 GPU 粒子群，随滚动在 11 个形态之间连续变形。
   模拟：位置 + 速度 ping-pong 浮点纹理；弹簧吸附、curl 噪声、
   鼠标涡旋、点击冲击波。文字形态直接光栅采样页面标题。
   降级：减少动画 → 静态定格帧；小屏 → 更少粒子；无 WebGL2 → 隐藏画布。
   ============================================================ */
(function () {
  'use strict';

  var W = 1.988; // 世界可见高度（z=0 平面）
  var XHS_URL = 'https://xhslink.cn/o/9q9VkvMTFqs';

  var statsHook = null; // site.js 可在任何时刻注册 HUD 回调
  var QF = {
    n: 0,
    ok: false,
    init: function () {},
    setInk: function () {},
    onStats: function (fn) { statsHook = fn; },
    label: ''
  };
  window.QF = QF;

  /* ---------- 小工具 ---------- */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.816; }
  function mk(N) { return new Float32Array(N * 4); }
  function put(a, i, x, y, z, b) { a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; a[i * 4 + 3] = b; }
  function rotXZ(p, ax, az) { // 先绕Y转az，再绕X压ax（用于立方体等）
    var c = Math.cos(az), s = Math.sin(az), x = p[0] * c + p[2] * s, z = -p[0] * s + p[2] * c;
    var c2 = Math.cos(ax), s2 = Math.sin(ax), y = p[1] * c2 - z * s2;
    z = p[1] * s2 + z * c2;
    return [x, y, z];
  }

  /* ---------- 光栅文字 ---------- */
  function rasterCanvas(text, font, ls) {
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = font;
    var m = ctx.measureText(text);
    var tw = m.width + Math.max(0, text.length - 1) * (ls || 0);
    var pxMatch = /(\d+(?:\.\d+)?)px/.exec(font);
    var fsz = pxMatch ? parseFloat(pxMatch[1]) : 100;
    cv.width = Math.max(8, Math.ceil(tw + fsz * 0.6));
    cv.height = Math.max(8, Math.ceil(fsz * 1.6 + 20));
    ctx.font = font;
    try { if (ls) ctx.letterSpacing = ls + 'px'; } catch (e) {}
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 30, cv.height * 0.52);
    return ctx.getImageData(0, 0, cv.width, cv.height);
  }
  function glyphPts(text, font, ls, targetH) { // 归一化点集，高度 targetH
    var id = rasterCanvas(text, font, ls);
    var pts = [], w = id.width, h = id.height, d = id.data;
    for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2)
      if (d[(y * w + x) * 4 + 3] > 100) pts.push([(x - w / 2) / h * targetH, -(y - h / 2) / h * targetH]);
    return pts;
  }

  /* ---------- 形态生成器（全部输出 N×4：xyz + 亮度） ---------- */

  // 文字：光栅采样页面真实标题
  function buildTrace(form, N, aspect) {
    var el = document.querySelector(form.el);
    var data = mk(N);
    if (!el) return data;
    var cs = getComputedStyle(el);
    var fs = parseFloat(cs.fontSize) || 100;
    var font = (parseInt(cs.fontWeight, 10) || 800) + ' ' + fs + 'px ' + cs.fontFamily;
    var ls = parseFloat(cs.letterSpacing) || 0;
    var id = rasterCanvas((form.text || el.textContent || '').trim(), font, ls);
    var w = id.width, h = id.height, d = id.data;
    var pts = [];
    var step = Math.max(1, Math.round(fs / 130)); // 细字重：加密采样保形态
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step)
      if (d[(y * w + x) * 4 + 3] > 100) pts.push(x, y);
    if (!pts.length) { form.empty = true; return data; }
    var px2w = W / window.innerHeight;
    // 固定呈现区域：文字形态一律落在屏幕中央安全带，不随采样时机漂移
    var cxr = form.cxR != null ? form.cxR : 0.5;
    var cyr = form.cyR != null ? form.cyR : 0.42;
    var cx = (cxr * 2 - 1) * aspect;
    var cy = -(cyr * 2 - 1);
    var s = px2w;
    var maxW = Math.min(W * aspect * 0.94, 3.6);
    if (w * s > maxW) s = maxW / w;
    var M = pts.length / 2;
    var hw = w * s * 0.5, hh = h * s * 0.5; // 文字半宽高（世界单位）
    for (var i = 0; i < N; i++) {
      if (Math.random() < 0.06) {
        // 远而稀的散逸微光，避开字形本体
        var ang = rnd(0, 6.2832), rr = rnd(1.32, 2.3);
        var ex = Math.cos(ang) * (hw * rr), ey = Math.sin(ang) * (hh * rr) * 0.62;
        put(data, i, cx + ex + gauss() * 0.05, cy + ey + gauss() * 0.05, rnd(-0.1, 0.1), rnd(0.05, 0.28));
        continue;
      }
      var j = (Math.random() * M) | 0;
      var dx = pts[j * 2] - w / 2 + rnd(-1.5, 1.5);
      var dy = -(pts[j * 2 + 1] - h / 2) + rnd(-1.5, 1.5);
      put(data, i, cx + dx * s, cy + dy * s, rnd(-0.035, 0.035), rnd(0.5, 1));
    }
    form.bakeScrollY = window.scrollY || window.pageYOffset || 0;
    form.empty = false;
    return data;
  }

  // 二维码（真实可扫，指向小红书主页）
  function buildQR(N, aspect) {
    var data = mk(N);
    var dark = [], cnt = 33;
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(XHS_URL); qr.make();
      cnt = qr.getModuleCount();
      for (var r = 0; r < cnt; r++) for (var c = 0; c < cnt; c++)
        if (qr.isDark(r, c)) dark.push([c, r]);
      // 三个定位角(回字)采样权重 ×3，扫一眼即可辨识
      var finderBoost = [];
      for (var fi = 0; fi < dark.length; fi++) {
        var fc = dark[fi][0], fr = dark[fi][1];
        if ((fc < 7 && fr < 7) || (fc >= cnt - 7 && fr < 7) || (fc < 7 && fr >= cnt - 7)) {
          finderBoost.push(dark[fi], dark[fi]);
        }
      }
      dark = dark.concat(finderBoost);
    } catch (e) {
      for (var rr = 0; rr < cnt; rr++) for (var cc = 0; cc < cnt; cc++)
        if (((rr * 7 + cc * 13 + ((rr * cc) % 5)) % 3) !== 0) dark.push([cc, rr]);
    }
    var size = Math.min(1.62, W * aspect * 0.82);
    var q = size * 0.86, mod = q / cnt, off = -q / 2;
    var nDust = Math.floor(N * 0.06);
    for (var i = 0; i < N; i++) {
      if (i < N - nDust) {
        var j = (Math.random() * dark.length) | 0;
        var c2 = dark[j][0], r2 = dark[j][1];
        // 收拢到模块中心，给暗模块留出干净间隙
        put(data, i,
          off + (c2 + rnd(0.38, 0.62)) * mod,
          off + (cnt - 1 - r2 + rnd(0.38, 0.62)) * mod,
          rnd(-0.02, 0.02), rnd(0.88, 1));
      } else {
        // 紧贴码边的安静微尘，不铺满全屏
        var ang = rnd(0, Math.PI * 2), rr2 = rnd(0.5, 0.6) * q;
        put(data, i, Math.cos(ang) * rr2, Math.sin(ang) * rr2, rnd(-0.04, 0.04), rnd(0.06, 0.2));
      }
    }
    return data;
  }

  // 山峦：三层山脊线 + 主峰雪顶
  function buildMountain(N) {
    var data = mk(N);
    var layers = [
      { amp: 0.36, base: 0.04, z: 0.12, b: 0.95, ph: 1.7, w: 0.50 },
      { amp: 0.28, base: -0.14, z: -0.2, b: 0.58, ph: 4.2, w: 0.30 },
      { amp: 0.2, base: -0.3, z: -0.52, b: 0.36, ph: 0.6, w: 0.20 }
    ];
    function ridgeY(x, L) {
      return L.base + L.amp * (0.55 * Math.sin(x * 2.1 + L.ph) + 0.3 * Math.sin(x * 4.7 + L.ph * 2.3) + 0.15 * Math.sin(x * 9.3 + L.ph * 0.7))
        + 0.52 * L.amp * Math.exp(-Math.pow((x - 0.28) * 2.4, 2));
    }
    for (var i = 0; i < N; i++) {
      var u = Math.random(), L = null, acc = 0;
      for (var k = 0; k < 3; k++) { acc += layers[k].w; if (u < acc) { L = layers[k]; break; } }
      if (!L) L = layers[0];
      var x = rnd(-1.14, 1.14), y = ridgeY(x, L);
      var b = L.b * rnd(0.85, 1);
      if (L === layers[0] && y > 0.3) b = rnd(0.95, 1);
      put(data, i, x, y + rnd(-0.006, 0.006), L.z + rnd(-0.03, 0.03), b);
    }
    return data;
  }

  // 地球：噪声大陆 + 赤道 + 倾斜
  function buildEarth(N) {
    var data = mk(N), R = 0.74;
    var tiltX = 0.38, tiltZ = 0.18;
    for (var i = 0; i < N; i++) {
      var zz = rnd(-1, 1), th = rnd(0, Math.PI * 2), rr = Math.sqrt(1 - zz * zz);
      var x = Math.cos(th) * rr, y = zz, z = Math.sin(th) * rr;
      var n = Math.sin(x * 3.1 + 1.3) * Math.sin(y * 2.7 - 0.6) * Math.sin(z * 3.4 + 2.1)
        + 0.5 * Math.sin(x * 6.3 + 0.7) * Math.sin(z * 5.1 - 1.9);
      var b = n > 0.22 ? rnd(0.78, 1) : rnd(0.28, 0.48);
      if (Math.abs(y) < 0.06 && Math.random() < 0.45) b = rnd(0.75, 0.95);
      var p = rotXZ([x * R, y * R, z * R], tiltX, tiltZ);
      put(data, i, p[0], p[1], p[2], b);
    }
    return data;
  }

  // 唱片：同心沟槽 + 标签 + 高光弧
  function buildVinyl(N) {
    var data = mk(N), R = 0.8, rings = 30;
    for (var i = 0; i < N; i++) {
      var u = Math.random(), x, y, b;
      if (u < 0.055) {
        var a1 = rnd(0, 6.2832), r1 = Math.sqrt(Math.random()) * 0.22;
        x = Math.cos(a1) * r1; y = Math.sin(a1) * r1; b = rnd(0.92, 1);
      } else if (u < 0.075) {
        var a2 = rnd(0, 6.2832), r2 = Math.sqrt(Math.random()) * 0.04;
        x = Math.cos(a2) * r2; y = Math.sin(a2) * r2; b = 1;
      } else if (u < 0.16) {
        var a3 = rnd(-0.55, 0.55), r3 = rnd(0.3, 0.76);
        x = Math.cos(a3) * r3; y = Math.sin(a3) * r3; b = rnd(0.7, 0.95);
      } else {
        var ring = Math.floor(Math.pow(Math.random(), 0.85) * rings);
        var r4 = 0.25 + (ring / rings) * (R - 0.25);
        var a4 = rnd(0, 6.2832);
        x = Math.cos(a4) * r4; y = Math.sin(a4) * r4;
        b = 0.34 + 0.16 * Math.sin(r4 * 34) + rnd(0, 0.1);
      }
      put(data, i, x, y, rnd(-0.015, 0.015), b);
    }
    return data;
  }

  // 太阳：核心圆盘 + 12 道光芒
  function buildSun(N) {
    var data = mk(N);
    for (var i = 0; i < N; i++) {
      var u = Math.random(), x, y, b;
      if (u < 0.44) {
        var a = rnd(0, 6.2832), r = Math.sqrt(Math.random()) * 0.35;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
        b = r < 0.13 ? rnd(0.95, 1) : rnd(0.68, 0.95);
      } else {
        var k = (Math.random() * 12) | 0;
        var baseA = k * Math.PI / 6;
        var len = (k % 2 === 0 ? 0.64 : 0.5) + rnd(-0.03, 0.03);
        var t = Math.pow(Math.random(), 0.72);
        var r5 = 0.39 + t * (len - 0.39);
        var halfw = (1 - t) * 0.105 + 0.018;
        var a5 = baseA + rnd(-halfw, halfw);
        x = Math.cos(a5) * r5; y = Math.sin(a5) * r5; b = rnd(0.6, 0.95);
      }
      put(data, i, x, y, rnd(-0.02, 0.02), b);
    }
    return data;
  }

  // 热气球：气球蒙皮 + 索具 + 吊篮 + 云
  function buildBalloon(N) {
    var data = mk(N);
    for (var i = 0; i < N; i++) {
      var u = Math.random(), x, y, z, b;
      if (u < 0.56) {
        var phi = ((Math.random() * 8) | 0) * Math.PI / 4 + rnd(-0.02, 0.02);
        var t = rnd(0, 1);
        var r = 0.52 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.15 * t) + 0.015;
        y = 0.56 - t * 1.06;
        x = Math.cos(phi) * r; z = Math.sin(phi) * r; b = rnd(0.7, 0.95);
      } else if (u < 0.72) {
        var t2 = [0.2, 0.46, 0.72][(Math.random() * 3) | 0];
        var r2 = 0.52 * Math.sin(Math.PI * Math.pow(t2, 0.8)) * (1 - 0.15 * t2);
        var ph2 = rnd(0, 6.2832);
        y = 0.56 - t2 * 1.06;
        x = Math.cos(ph2) * r2; z = Math.sin(ph2) * r2; b = rnd(0.4, 0.62);
      } else if (u < 0.85) {
        var side = (Math.random() * 4) | 0;
        var phi3 = side * Math.PI / 2 + Math.PI / 4;
        var t3 = rnd(0, 1);
        var r3 = 0.17 + (0.075 - 0.17) * t3;
        y = -0.5 + (-0.8 + 0.5) * t3;
        x = Math.cos(phi3) * r3; z = Math.sin(phi3) * r3; b = rnd(0.5, 0.7);
      } else if (u < 0.96) {
        // 吊篮：小方盒线框
        var ex = rnd(-0.095, 0.095), ey = rnd(-0.055, 0.055), ez = rnd(-0.06, 0.06);
        var onEdge = (Math.abs(Math.abs(ex) - 0.095) < 0.012) || (Math.abs(Math.abs(ey) - 0.055) < 0.008) || (Math.abs(Math.abs(ez) - 0.06) < 0.008);
        if (onEdge || Math.random() < 0.3) { x = ex; y = -0.9 + ey; z = ez; b = rnd(0.85, 1); }
        else { x = ex; y = -0.9 + ey; z = ez; b = rnd(0.2, 0.45); }
      } else {
        var g = (Math.random() * 2) | 0 ? [0.85, -0.18] : [-0.8, -0.4];
        x = g[0] + gauss() * 0.13; y = g[1] + gauss() * 0.05; z = -0.3 + gauss() * 0.06;
        b = rnd(0.15, 0.4);
      }
      put(data, i, x, y, z, b);
    }
    return data;
  }

  // 盲盒：等距立方 + 悬浮盒盖 + 问号 + 迸出的星光
  function buildBlindbox(N) {
    var data = mk(N);
    var H = 0.32, y0 = -0.34, ax = 0.32, az = 0.62;
    function edge(a, b, arr) { arr.push([a, b]); }
    var edges = [];
    var c = function (sx, sy, sz) { return [sx * H, y0 + sy * H, sz * H]; };
    edge(c(-1, -1, -1), c(1, -1, -1), edges); edge(c(1, -1, -1), c(1, -1, 1), edges);
    edge(c(1, -1, 1), c(-1, -1, 1), edges); edge(c(-1, -1, 1), c(-1, -1, -1), edges);
    edge(c(-1, 1, -1), c(1, 1, -1), edges); edge(c(1, 1, -1), c(1, 1, 1), edges);
    edge(c(1, 1, 1), c(-1, 1, 1), edges); edge(c(-1, 1, 1), c(-1, 1, -1), edges);
    edge(c(-1, -1, -1), c(-1, 1, -1), edges); edge(c(1, -1, -1), c(1, 1, -1), edges);
    edge(c(1, -1, 1), c(1, 1, 1), edges); edge(c(-1, -1, 1), c(-1, 1, 1), edges);
    var lid = [];
    var c2f = function (sx, sz) { return [sx * H * 1.12, y0 + H + 0.2, sz * H * 1.12]; };
    edge(c2f(-1, -1), c2f(1, -1), lid); edge(c2f(1, -1), c2f(1, 1), lid);
    edge(c2f(1, 1), c2f(-1, 1), lid); edge(c2f(-1, 1), c2f(-1, -1), lid);
    var qpts = glyphPts('?', '800 150px Archivo, "Archivo", sans-serif', 0, 0.42);
    var box3 = [], lid3 = [];
    for (var e0 = 0; e0 < edges.length; e0++) {
      var A = rotXZ(edges[e0][0], ax, az), B = rotXZ(edges[e0][1], ax, az);
      box3.push([A, B]);
    }
    for (var e1 = 0; e1 < lid.length; e1++) {
      var A2 = rotXZ(lid[e1][0], ax, az), B2 = rotXZ(lid[e1][1], ax, az);
      lid3.push([A2, B2]);
    }
    function onSeg(segs) {
      var s = segs[(Math.random() * segs.length) | 0];
      var t = Math.random();
      return [s[0][0] + (s[1][0] - s[0][0]) * t + rnd(-0.006, 0.006),
              s[0][1] + (s[1][1] - s[0][1]) * t + rnd(-0.006, 0.006),
              s[0][2] + (s[1][2] - s[0][2]) * t + rnd(-0.006, 0.006)];
    }
    for (var i = 0; i < N; i++) {
      var u = Math.random(), p, b;
      if (u < 0.44) { p = onSeg(box3); b = rnd(0.7, 0.95); }
      else if (u < 0.6) { p = onSeg(lid3); b = rnd(0.85, 1); }
      else if (u < 0.88 && qpts.length) {
        var qp = qpts[(Math.random() * qpts.length) | 0];
        p = [qp[0] * 0.9, qp[1] * 0.9 + 0.24, 0.34 + rnd(-0.02, 0.02)]; b = rnd(0.8, 1);
      } else {
        var g2 = [[0.3, 0.42, 0.3], [-0.38, 0.3, 0.15], [0.42, 0.18, -0.2]][(Math.random() * 3) | 0];
        p = [g2[0] + gauss() * 0.09, g2[1] + gauss() * 0.09, g2[2] + gauss() * 0.09];
        b = rnd(0.45, 1);
      }
      put(data, i, p[0], p[1], p[2], b);
    }
    return data;
  }

  // 心跳线：两次搏动 + 背后一颗淡淡的心
  function ecgY(x) {
    function beat(bx, amp) {
      var dx = x - bx, w = 0.34;
      if (Math.abs(dx) > w) return 0;
      var t = dx / w, y = 0;
      y += 0.1 * amp * Math.exp(-Math.pow((t + 0.62) / 0.14, 2));
      y += -0.07 * amp * Math.exp(-Math.pow((t + 0.16) / 0.045, 2));
      y += 1.0 * amp * Math.exp(-Math.pow(t / 0.055, 2));
      y += -0.22 * amp * Math.exp(-Math.pow((t - 0.13) / 0.05, 2));
      y += 0.22 * amp * Math.exp(-Math.pow((t - 0.5) / 0.16, 2));
      return y;
    }
    return beat(-0.42, 1) + beat(0.5, 0.6);
  }
  function buildHeart(N) {
    var data = mk(N);
    for (var i = 0; i < N; i++) {
      var u = Math.random();
      if (u < 0.82) {
        var x = rnd(-1.12, 1.12), y = ecgY(x);
        // 基线也要亮，尖峰最亮
        put(data, i, x, y * 0.52 - 0.04, rnd(-0.02, 0.02), y > 0.3 ? 1 : rnd(0.72, 0.95));
      } else {
        var t = rnd(0, 6.2832);
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        put(data, i, hx * 0.021, hy * 0.021 + 0.02, -0.28, rnd(0.07, 0.18));
      }
    }
    return data;
  }

  /* ---------- 着色器 ---------- */
  var NOISE_GLSL = [
    'float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
    'float vnoise(vec3 p){',
    '  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash13(i), b = hash13(i + vec3(1.,0.,0.)), c = hash13(i + vec3(0.,1.,0.)), d = hash13(i + vec3(1.,1.,0.));',
    '  float e = hash13(i + vec3(0.,0.,1.)), g = hash13(i + vec3(1.,0.,1.)), h = hash13(i + vec3(0.,1.,1.)), k = hash13(i + vec3(1.,1.,1.));',
    '  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);',
    '}',
    'vec3 curl(vec3 p){',
    '  float e2 = 0.14;',
    '  vec3 dx = vec3(e2,0.,0.), dy = vec3(0.,e2,0.), dz = vec3(0.,0.,e2);',
    '  vec3 o2 = vec3(31.4,47.2,12.9), o3 = vec3(73.1,5.7,91.3);',
    '  float a1 = vnoise(p), a2 = vnoise(p+dx), a3 = vnoise(p-dx);',
    '  float a4 = vnoise(p+dy), a5 = vnoise(p-dy), a6 = vnoise(p+dz), a7 = vnoise(p-dz);',
    '  float b1 = vnoise(p+o2), b2 = vnoise(p+o2+dx), b3 = vnoise(p+o2-dx);',
    '  float b4 = vnoise(p+o2+dy), b5 = vnoise(p+o2-dy), b6 = vnoise(p+o2+dz), b7 = vnoise(p+o2-dz);',
    '  float c1 = vnoise(p+o3), c2 = vnoise(p+o3+dx), c3 = vnoise(p+o3-dx);',
    '  float c4 = vnoise(p+o3+dy), c5 = vnoise(p+o3-dy), c6 = vnoise(p+o3+dz), c7 = vnoise(p+o3-dz);',
    '  return vec3((c4-c5)-(b6-b7), (a6-a7)-(c2-c3), (b4-b5)-(a2-a3)) / (2.0 * e2);',
    '}'
  ].join('\n');

  var QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

  var VEL_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uPos, uVel, uTA, uTB;',
    'uniform vec2 uMouse; uniform float uMouseE;',
    'uniform vec3 uClick;',
    'uniform float uTime, uDt, uMorph, uSweep, uSweepOn, uIdle, uAspect, uCalm;',
    'uniform vec2 uRotA, uRotB; uniform float uDyA, uDyB; uniform vec2 uOffA, uOffB;',
    NOISE_GLSL,
    'vec3 rotZY(vec3 p, vec2 r){',
    '  float c = cos(r.x), s = sin(r.x); p.xy = mat2(c, -s, s, c) * p.xy;',
    '  c = cos(r.y); s = sin(r.y); p.xz = mat2(c, -s, s, c) * p.xz;',
    '  return p;',
    '}',
    'void main(){',
    '  vec4 pos = texture2D(uPos, vUv);',
    '  vec4 vel = texture2D(uVel, vUv);',
    '  float seed = vel.w;',
    '  vec4 ta = texture2D(uTA, vUv);',
    '  vec4 tb = texture2D(uTB, vUv);',
    '  vec3 A = rotZY(ta.xyz, uRotA); A.xy += uOffA; A.y += uDyA;',
    '  vec3 B = rotZY(tb.xyz, uRotB); B.xy += uOffB; B.y += uDyB;',
    '  float h = fract(seed * 7.13);',
    '  float k = smoothstep(h * 0.45, h * 0.45 + 0.55, uMorph);',
    '  vec3 T = mix(A, B, k);',
    '  if (uSweepOn > 0.5) {',
    '    float xr = T.x / (1.988 * uAspect) + 0.5;',
    '    float gate = smoothstep(uSweep, uSweep + 0.10, xr);',
    '    vec3 fp = vec3(sin(seed * 37.7 + uTime * 0.35) * uAspect * 1.25,',
    '                   cos(seed * 23.3 - uTime * 0.30) * 1.25,',
    '                   sin(seed * 11.9 + uTime * 0.22) * 0.7);',
    '    T = mix(T, fp, gate);',
    '  }',
    '  vec3 v = vel.xyz;',
    '  vec3 spring = (T - pos.xyz) * 6.2;',
    '  v += spring * uDt;',
    '  float turb = (0.26 + uIdle * 0.7) * uCalm;',
    '  v += curl(pos.xyz * 1.9 + vec3(0.0, 0.0, uTime * 0.09)) * turb * uDt;',
    '  vec2 mp = pos.xy - uMouse;',
    '  float r2 = dot(mp, mp);',
    '  float infl = exp(-r2 / 0.22) * uMouseE;',
    '  vec2 dir = mp / sqrt(r2 + 1e-5);',
    // 涡旋主导 + 轻推：鼠标处形成绕转的彩色流
    '  v.xy += (vec2(-dir.y, dir.x) * 3.2 + dir * 0.55) * infl * uDt;',
    '  v.z += dir.x * infl * uDt * 1.2;',
    '  vec2 cp = pos.xy - uClick.xy;',
    '  float cr = length(cp);',
    '  float R = uClick.z * 2.8;',
    '  float band = exp(-pow(cr - R, 2.0) / 0.02) * exp(-uClick.z * 2.6) * step(0.001, uClick.z);',
    '  v.xy += (cp / (cr + 1e-4)) * band * 2.2 * uDt * 6.0;',
    // 定格：calm 低时冻结惯性（弹簧直驱吸附目标点），鼠标附近保持流动
    '  float mNear = exp(-r2 / 0.5) * uMouseE;',
    '  float frozen = (1.0 - smoothstep(0.03, 0.5, uCalm)) * (1.0 - mNear);',
    '  v *= mix(exp(-3.5 * uDt), 0.03, frozen);',
    '  v += spring * 0.97 * frozen;',
    '  gl_FragColor = vec4(v, seed);',
    '}'
  ].join('\n');

  var POS_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uPos, uVel;',
    'uniform float uDt;',
    'void main(){',
    '  vec4 pos = texture2D(uPos, vUv);',
    '  vec4 vel = texture2D(uVel, vUv);',
    '  pos.xyz += vel.xyz * uDt;',
    '  gl_FragColor = pos;',
    '}'
  ].join('\n');

  var COPY_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'void main(){ gl_FragColor = texture2D(uTex, vUv); }'
  ].join('\n');

  var PTS_VS = [
    'attribute vec2 aRef;',
    'attribute float aSeed;',
    'uniform sampler2D uPos, uVel, uTA, uTB;',
    'uniform float uMorph, uDPR, uAspect, uInk;',
    'uniform vec2 uRotA, uRotB;',
    'uniform float uDyA, uDyB;',
    'uniform vec2 uOffA, uOffB;',
    'varying float vB; varying float vHeat; varying float vSettle; varying float vHue;',
    'vec3 rotZY(vec3 p, vec2 r){',
    '  float c = cos(r.x), s = sin(r.x);',
    '  p.xy = mat2(c, -s, s, c) * p.xy;',
    '  c = cos(r.y); s = sin(r.y);',
    '  p.xz = mat2(c, -s, s, c) * p.xz;',
    '  return p;',
    '}',
    'void main(){',
    '  vec3 pos = texture2D(uPos, aRef).xyz;',
    '  vec3 vel = texture2D(uVel, aRef).xyz;',
    '  vec4 ta = texture2D(uTA, aRef);',
    '  vec4 tb = texture2D(uTB, aRef);',
    '  float h = fract(aSeed * 7.13);',
    '  float k = smoothstep(h * 0.45, h * 0.45 + 0.55, uMorph);',
    '  vB = mix(ta.w, tb.w, k);',
    '  vHeat = clamp(length(vel) * 0.9, 0.0, 1.0);',
    '  vec3 A = rotZY(ta.xyz, uRotA); A.xy += uOffA; A.y += uDyA;',
    '  vec3 B = rotZY(tb.xyz, uRotB); B.xy += uOffB; B.y += uDyB;',
    '  vec3 T = mix(A, B, k);',
    // 颜色层次：以形态中心为基准的垂直渐变（底深红 → 中落日橙 → 顶亮金）+ 粒子微扰
    '  vHue = clamp(0.50 + (T.y - 0.18) * 2.6 + (fract(aSeed * 0.61803398875) - 0.5) * 0.22, 0.0, 0.85);',
    '  float dT = distance(T, pos);',
    '  vSettle = 1.0 - smoothstep(0.012, 0.22, dT);',
    '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    // 定格成画时粒子收细（细字重笔画更显纤细），飞行时保持蓬松
    '  float sz = (1.5 + vB * 2.4 + vHeat * 1.8) * mix(1.0, 0.68, vSettle) * uDPR * (2.4 / max(0.4, -mv.z)) * (1.0 + uInk * 0.4);',
    '  gl_PointSize = clamp(sz, 1.0, 26.0);',
    '}'
  ].join('\n');

  var PTS_FS = [
    'precision highp float;',
    'varying float vB; varying float vHeat; varying float vSettle; varying float vHue;',
    'uniform float uInk;',
    'void main(){',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.08, d);',
    // 暖色彩带：珊瑚红 → 落日橙 → 金，天青点缀（红与青占比加大）
    '  vec3 cA = vec3(1.00, 0.26, 0.34);',
    '  vec3 cB = vec3(1.00, 0.55, 0.18);',
    '  vec3 cC = vec3(1.00, 0.84, 0.42);',
    '  vec3 cD = vec3(0.55, 0.85, 1.00);',
    '  vec3 c;',
    '  if (vHue < 0.42) c = mix(cA, cB, vHue / 0.42);',
    '  else if (vHue < 0.80) c = mix(cB, cC, (vHue - 0.42) / 0.38);',
    '  else c = mix(cC, cD, (vHue - 0.80) / 0.20);',
    '  c *= 0.7 + 0.3 * vB;',
    '  vec3 hot = vec3(1.0, 0.96, 0.88);',
    '  c = mix(c, hot, vHeat * 0.4);',
    // 亮色主题：彩色转为低饱和墨彩，保留一点色相痕迹
    '  c = mix(c, c * 0.55 + vec3(0.14, 0.10, 0.08), uInk);',
    // 飞行中的粒子在文字上方变淡，落定后才亮起；亮色模式下墨点加实
    '  float alpha = a * (0.46 + 0.66 * vB + uInk * 0.18) * (0.16 + 0.84 * vSettle);',
    '  if (alpha < 0.01) discard;',
    '  gl_FragColor = vec4(c, alpha);',
    '}'
  ].join('\n');

  var AMB_VS = [
    'attribute float aSeed;',
    'uniform float uTime, uDPR, uAspect;',
    'varying float vA; varying float vHue;',
    'void main(){',
    '  float s = aSeed;',
    '  float t = uTime * 0.5;',
    '  vec3 p = vec3(',
    '    sin(s * 6.2831 + t * 0.32) * (1.05 + fract(s * 7.7)) * uAspect,',
    '    sin(s * 12.9 + t * 0.41) * 1.08 + sin(s * 3.1) * 0.2,',
    '    sin(s * 40.0) * 0.55);',
    '  vA = 0.16 + 0.2 * fract(s * 5.3);',
    '  vHue = fract(s * 13.7);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = (1.1 + fract(s * 9.1) * 1.4) * uDPR;',
    '}'
  ].join('\n');

  var AMB_FS = [
    'precision highp float;',
    'varying float vA; varying float vHue;',
    'uniform float uInk;',
    'void main(){',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.1, d) * vA * (1.0 - uInk * 0.45);',
    // 微尘三色：暖金与珊瑚为主，青色比例提高（微尘独立不叠加，彩色最清晰）
    '  vec3 c1 = vec3(1.00, 0.80, 0.50);',
    '  vec3 c2 = vec3(1.00, 0.55, 0.55);',
    '  vec3 c3 = vec3(0.60, 0.88, 1.00);',
    '  vec3 c = vHue < 0.6 ? mix(c1, c2, vHue / 0.6) : mix(c2, c3, (vHue - 0.6) / 0.4);',
    '  c = mix(c, c * 0.5, uInk);',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(c, a);',
    '}'
  ].join('\n');

  /* ---------- 引擎主体 ---------- */
  function boot() {
    try { init0(); } catch (err) {
      console.error('[微光场] 初始化失败：', err);
      document.body.classList.add('no-webgl');
    }
  }

  function init0() {
    var canvas = document.getElementById('field');
    if (!canvas) return;

    // WebGL2 预检
    var probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) { document.body.classList.add('no-webgl'); return; }

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 粒子分档
    var small = window.matchMedia('(max-width: 760px)').matches || ('ontouchstart' in window && Math.min(screen.width, screen.height) < 820);
    var N = 65536;
    if (small) N = 16384;
    else if ((navigator.hardwareConcurrency || 8) <= 6 || Math.min(screen.width, screen.height) < 900) N = 36864;
    QF.n = N;

    var S = Math.ceil(Math.sqrt(N)); // 纹理边长
    var NP = S * S;                  // 纹理内点数（>= N）

    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10);
    camera.position.z = 2.4;

    var simScene = new THREE.Scene();
    var simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var quadGeo = new THREE.PlaneGeometry(2, 2);
    var quad = new THREE.Mesh(quadGeo, null);
    quad.frustumCulled = false;
    simScene.add(quad);

    // 浮点渲染目标
    var floatOK = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float');
    var fType = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    function mkRT() {
      return new THREE.WebGLRenderTarget(S, S, {
        type: fType, format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false
      });
    }
    var rtPos = [mkRT(), mkRT()], rtVel = [mkRT(), mkRT()], cur = 0;

    /* ----- 形态注册表 ----- */
    var aspect = window.innerWidth / window.innerHeight;
    var FORMS = {
      qf77:     { label: '清风77', trace: true, el: '#hero-title', build: buildTrace },
      viva:     { label: 'VIVA LA VIDA', trace: true, el: '#hero-viva-text', build: buildTrace },
      n77:      { label: '77 · 意义碎片', trace: true, el: '#n77-text', build: buildTrace },
      heart:    { label: '心跳 · 活着的证据', build: buildHeart, sc: 0.72, dim: 0.5, anchor: '#an-heart' },
      blindbox: { label: '盲盒 · 77 个未知', build: buildBlindbox, sc: 0.42, ox: 0.68, oy: 0.33, thin: 0.55, dim: 0.52, anchor: '#an-blindbox' },
      vinyl:    { label: '唱片 · 人生这首歌', build: buildVinyl, sc: 0.55, ox: 0.72, dim: 0.55, spinZ: 0.55, anchor: '#an-vinyl' },
      mountain: { label: '爬坡 · 起起伏伏', build: buildMountain, sc: 0.6, oy: 0.33, anchor: '#an-mountain' },
      earth:    { label: '世界 · 去看', build: buildEarth, sc: 0.46, ox: 0.65, oy: 0.4, dim: 0.26, spinY: 0.2 },
      sun:      { label: '太阳 · 种下的光', build: buildSun, sc: 0.42, oy: 0.5, ox: 0.2, spinZ: 0.07, anchor: '#an-sun' },
      balloon:  { label: '热气球 · 正在升空', build: buildBalloon, sc: 0.72, oy: 0.1, anchor: '#an-balloon' },
      qr:       { label: '二维码 · 扫我', build: buildQR, sc: 0.62, ox: 0.58, oy: 0.3, dim: 1, oxS: 0, oyS: -0.12, scS: 0.42, calm: true, anchor: '#qr-anchor' }
    };

    /* ----- 粒子落点锁定到 DOM 锚点（所有形态与二维码同机制） ----- */
    function measureAnchors() {
      try {
        for (var id in FORMS) {
          var f = FORMS[id];
          if (!f.anchor) continue;
          var el = document.querySelector(f.anchor);
          if (!el) continue;
          var r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) { f._anchored = false; continue; } // 手机端隐藏的锚点 → 回退 oxS/oyS
          // 按「所在章节居中时锚点的视口位置」折算世界坐标（滚动无关：锚点与章节的相对差）
          var sec = el.closest ? el.closest('.chapter') : null;
          if (!sec) continue;
          var sr = sec.getBoundingClientRect();
          if (sr.height < 2) continue;
          var cyr = 0.5 + ((r.top + r.height / 2) - (sr.top + sr.height / 2)) / window.innerHeight;
          var cxr = (r.left + r.width / 2) / window.innerWidth;
          if (f.trace) { f.cxR = cxr; f.cyR = cyr; }
          else { f.ox = (cxr * 2 - 1) * aspect; f.oy = (0.5 - cyr) * W; }
          f._anchored = true;
        }
        // seq2：粒子「清风77」始终落在 h1#hero-title 的框内
        var ht = document.getElementById('hero-title');
        if (ht) {
          var hr = ht.getBoundingClientRect();
          if (hr.width > 0 && hr.height > 0) {
            FORMS.qf77.cxR = (hr.left + hr.width / 2) / window.innerWidth;
            FORMS.qf77.cyR = (hr.top + hr.height / 2) / window.innerHeight;
          }
        }
      } catch (e) {}
    }
    // 实时跟踪：活动形态的粒子跟着锚点走（与二维码同一机制）
    var qrTrackT = 0, qrCalmHold = 0;
    function trackActiveAnchors(force) {
      try {
        var ids = [];
        if (st.formA) ids.push(st.formA);
        if (st.formB && st.formB !== st.formA) ids.push(st.formB);
        var moved = false;
        for (var i = 0; i < ids.length; i++) {
          var f = FORMS[ids[i]];
          if (!f || !f.anchor || f.trace) continue;
          var el = document.querySelector(f.anchor);
          if (!el) continue;
          var r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          var ax = (r.left + r.width / 2) / window.innerWidth;
          var ay = (r.top + r.height / 2) / window.innerHeight;
          var nx = (ax * 2 - 1) * aspect;
          var ny = (0.5 - ay) * W;
          if (force || Math.abs(nx - f.ox) + Math.abs(ny - f.oy) > 0.03) {
            f.ox = nx;
            f.oy = ny;
            f._anchored = true;
            moved = true; // 偏移走 uniform，下一帧自动生效，无需重建纹理
          }
        }
        if (moved) {
          // 解除定格并保持 2.2s：粒子飞到新停位后再冻结成画
          st.calm = Math.max(st.calm, 0.85);
          qrCalmHold = 2.2;
        }
      } catch (e) {}
    }
    measureAnchors();

    var formTex = {};
    function buildFormTex(id) {
      var f = FORMS[id];
      var data = f.trace ? f.build(f, NP, aspect) : f.build(NP, aspect);
      // 每形态独立缩放与偏移（文字形态保持元素原位）
      if (!f.trace) {
        var small = window.innerWidth < 900; // 手机：整体缩小
        var gs = small ? (f.scS != null ? f.scS : (f.sc || 0.84) * 0.62) : (f.sc || 0.84);
        // 偏移不再烘焙进纹理：由 uOffA/uOffB 每帧注入（旋转围绕形态自身中心）
        var dim = (f.dim != null ? f.dim : 1) * (small ? 0.55 : 1); // 手机整体调淡为水印级，让位正文
        var thin = f.thin || 0;
        for (var i = 0; i < NP; i++) {
          if (thin && Math.random() < thin) {
            // 部分粒子疏散为远处微尘，避免小图高密度糊成亮斑
            var fa = rnd(0, 6.2832), fr = rnd(1.6, 2.8);
            put(data, i, Math.cos(fa) * fr, Math.sin(fa) * fr * 0.62, rnd(-0.5, 0.5), rnd(0.02, 0.1));
            continue;
          }
          data[i * 4] = data[i * 4] * gs;
          data[i * 4 + 1] = data[i * 4 + 1] * gs;
          data[i * 4 + 2] *= gs;
          data[i * 4 + 3] *= dim;
        }
      }
      var tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      formTex[id] = tex;
      return tex;
    }
    // 先建首屏，再建其余
    buildFormTex('qf77');
    for (var fid in FORMS) if (!formTex[fid]) buildFormTex(fid);

    /* ----- 初始 pos/vel 数据 ----- */
    var pos0 = mk(NP), vel0 = mk(NP);
    for (var i = 0; i < NP; i++) {
      pos0[i * 4] = rnd(-0.05, 0.05); pos0[i * 4 + 1] = rnd(-0.05, 0.05); pos0[i * 4 + 2] = rnd(-0.05, 0.05); pos0[i * 4 + 3] = 1;
      vel0[i * 4 + 3] = Math.random(); // seed 存进 w
    }
    function dataTex(d) {
      var t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true; return t;
    }

    /* ----- 模拟材质 ----- */
    var velMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: VEL_FS,
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uTA: { value: null }, uTB: { value: null },
        uMouse: { value: new THREE.Vector2(0, 0) }, uMouseE: { value: 0 },
        uClick: { value: new THREE.Vector3(0, 0, 0) },
        uTime: { value: 0 }, uDt: { value: 1 / 60 }, uMorph: { value: 1 },
        uSweep: { value: 1 }, uSweepOn: { value: 0 }, uIdle: { value: 0 },
        uAspect: { value: aspect }, uCalm: { value: 1 },
        uRotA: { value: new THREE.Vector2(0, 0) }, uRotB: { value: new THREE.Vector2(0, 0) },
        uDyA: { value: 0 }, uDyB: { value: 0 },
        uOffA: { value: new THREE.Vector2(0, 0) }, uOffB: { value: new THREE.Vector2(0, 0) }
      }
    });
    var posMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: POS_FS,
      uniforms: { uPos: { value: null }, uVel: { value: null }, uDt: { value: 1 / 60 } }
    });
    var copyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: COPY_FS,
      uniforms: { uTex: { value: null } }
    });

    // 初始数据灌入渲染目标
    function seedRT(rt, srcTex) {
      copyMat.uniforms.uTex.value = srcTex;
      quad.material = copyMat;
      renderer.setRenderTarget(rt);
      renderer.render(simScene, simCam);
      renderer.setRenderTarget(null);
    }
    seedRT(rtPos[0], dataTex(pos0));
    seedRT(rtVel[0], dataTex(vel0));

    /* ----- 粒子渲染 ----- */
    var geo = new THREE.BufferGeometry();
    var dummy = new Float32Array(NP * 3), refs = new Float32Array(NP * 2), seeds = new Float32Array(NP);
    for (var g = 0; g < NP; g++) {
      refs[g * 2] = (g % S + 0.5) / S; refs[g * 2 + 1] = (Math.floor(g / S) + 0.5) / S;
      seeds[g] = vel0[g * 4 + 3];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
    geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setDrawRange(0, N);

    var ptsMat = new THREE.ShaderMaterial({
      vertexShader: PTS_VS, fragmentShader: PTS_FS,
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uTA: { value: null }, uTB: { value: null },
        uMorph: { value: 1 }, uDPR: { value: DPR }, uAspect: { value: aspect }, uInk: { value: 0 },
        uRotA: { value: new THREE.Vector2() }, uRotB: { value: new THREE.Vector2() },
        uDyA: { value: 0 }, uDyB: { value: 0 },
        uOffA: { value: new THREE.Vector2(0, 0) }, uOffB: { value: new THREE.Vector2(0, 0) }
      },
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending
    });
    var points = new THREE.Points(geo, ptsMat);
    points.frustumCulled = false;
    scene.add(points);

    // 氛围层（始终缓慢漂移的小点）
    var AN = 2200;
    var ambGeo = new THREE.BufferGeometry();
    var ambPos = new Float32Array(AN * 3), ambSeed = new Float32Array(AN);
    for (var a = 0; a < AN; a++) ambSeed[a] = Math.random();
    ambGeo.setAttribute('position', new THREE.BufferAttribute(ambPos, 3));
    ambGeo.setAttribute('aSeed', new THREE.BufferAttribute(ambSeed, 1));
    var ambMat = new THREE.ShaderMaterial({
      vertexShader: AMB_VS, fragmentShader: AMB_FS,
      uniforms: { uTime: { value: 0 }, uDPR: { value: DPR }, uAspect: { value: aspect }, uInk: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending
    });
    var ambient = new THREE.Points(ambGeo, ambMat);
    ambient.frustumCulled = false;
    scene.add(ambient);

    /* ----- 章节 ----- */
    var chapters = [];
    var chEls = document.querySelectorAll('[data-forms]');
    for (var ci = 0; ci < chEls.length; ci++) {
      var el = chEls[ci];
      chapters.push({
        el: el,
        forms: el.getAttribute('data-forms').split(',').map(function (s) { return s.trim(); }),
        split: parseFloat(el.getAttribute('data-split')) || 0,
        labels: (el.getAttribute('data-labels') || '').split('/').map(function (s) { return s.trim(); }),
        stage: 0
      });
    }

    /* ----- 状态机 ----- */
    var st = {
      formA: 'qf77', formB: 'qf77', morphT: 1,
      sweepOn: 0, sweep: 1, sweepT0: 0, sweepDur: 1.25, sweepDelay: 0.3,
      angles: {}, ink: 0, inkTarget: 0,
      calm: 1, calmTarget: 1,
      mouseE: 0, mouseSpeed: 0, pointerOn: false,
      clickAge: 99, clickPos: [0, 0],
      time: 0, lastT: performance.now(),
      active: null, label: '清风77',
      fps: 60, fpsEma: 60, lastHud: 0
    };
    st.angles.qf77 = 0; st.angles.viva = 0; st.angles.tiyanjia = 0;
    st.angles.heart = 0; st.angles.blindbox = 0; st.angles.vinyl = 0;
    st.angles.mountain = 0; st.angles.earth =  0; st.angles.sun = 0;
    st.angles.balloon = 0; st.angles.qr = 0;

    var px2w = W / window.innerHeight;

    function formAngle(id, dt) {
      var f = FORMS[id];
      st.angles[id] = (st.angles[id] || 0) + (f.spinZ || 0) * st.time; // 由 time 直接驱动
      return [
        (f.spinZ || 0) * st.time,
        (f.spinY || 0) * st.time
      ];
    }

    var rebakeTimers = {};
    function morphTo(id, instant) {
      if (!FORMS[id] || !formTex[id]) return;
      if (id === st.formB && st.morphT >= 1 && !instant) return;
      if (id === st.formB && st.morphT >= 1) { // 同形态重新入场（重进章节）
        st.sweepOn = reduced ? 0 : 1; st.sweep = reduced ? 1 : 0; st.sweepT0 = st.time;
        if (FORMS[id].trace) scheduleRebake(id, true);
        return;
      }
      // A ← 当前逻辑形态
      if (st.morphT >= 1) st.formA = st.formB;
      st.formB = id;
      if (FORMS[id].trace) scheduleRebake(id, false);
      st.morphT = instant ? 1 : 0;
      st.sweepOn = reduced ? 0 : 1;
      st.sweep = (instant || reduced) ? 1 : 0;
      st.sweepT0 = st.time;
      st.label = FORMS[id].label || id;
      QF.label = st.label;
      if (reduced && !instant) settle();
    }

    // 立即采样，并安排进场动画结束后重采样一次（标题 .rv 位移归位后）
    function scheduleRebake(id, immediateOnly) {
      rebuildTrace(id);
      if (immediateOnly) return;
      if (rebakeTimers[id]) clearTimeout(rebakeTimers[id]);
      rebakeTimers[id] = setTimeout(function () {
        rebuildTrace(id);
        if (reduced) { pickChapter(); renderOnce(); }
      }, 1150);
    }

    function rebuildTrace(id) {
      var f = FORMS[id];
      if (!f.trace) return;
      var data = f.build(f, NP, aspect);
      if (f.empty) return;
      var tex = formTex[id];
      tex.image.data.set(data);
      tex.needsUpdate = true;
    }

    /* ----- 指针 / 点击 ----- */
    var lastPX = null, lastPY = null;
    function onPointer(x, y) {
      var wx = (x / window.innerWidth * 2 - 1) * aspect;
      var wy = -(y / window.innerHeight * 2 - 1);
      if (lastPX !== null) {
        var sp = Math.hypot(x - lastPX, y - lastPY);
        st.mouseSpeed = st.mouseSpeed * 0.82 + Math.min(1, sp / 34) * 0.18;
      }
      lastPX = x; lastPY = y;
      velMat.uniforms.uMouse.value.set(wx, wy);
    }
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'touch') st.pointerOn = true;
      onPointer(e.clientX, e.clientY);
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', function () { st.pointerOn = false; }, { passive: true });
    window.addEventListener('blur', function () { st.pointerOn = false; }, { passive: true });
    window.addEventListener('pointerdown', function (e) {
      var wx = (e.clientX / window.innerWidth * 2 - 1) * aspect;
      var wy = -(e.clientY / window.innerHeight * 2 - 1);
      st.clickPos = [wx, wy]; st.clickAge = 0;
    }, { passive: true });

    /* ----- 滚动章节检测 ----- */
    var rects = [];
    function measure() {
      rects.length = 0;
      for (var i = 0; i < chapters.length; i++) {
        var r = chapters[i].el.getBoundingClientRect();
        rects.push({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, h: r.height });
      }
    }
    function pickChapter() {
      var mid = window.scrollY + window.innerHeight / 2;
      var best = -1;
      // 严格包含优先（章节连续无缝），避免长章节吞掉后邻的短插章
      for (var i = 0; i < chapters.length; i++) {
        var r = rects[i];
        if (r.top <= mid && mid < r.bottom) { best = i; break; }
      }
      if (best < 0) { // 兜底：取中心最近
        var bd = 1e12;
        for (var j = 0; j < chapters.length; j++) {
          var c = (rects[j].top + rects[j].bottom) / 2;
          var d = Math.abs(c - mid);
          if (d < bd) { bd = d; best = j; }
        }
      }
      if (best < 0) return;
      var ch = chapters[best], r = rects[best];
      var p = (mid - r.top) / Math.max(1, r.h);
      var stage = (ch.split && p > ch.split) ? 1 : 0;
      if (st.active !== ch || ch.stage !== stage) {
        st.active = ch; ch.stage = stage;
        var fid = ch.forms[Math.min(stage, ch.forms.length - 1)];
        morphTo(fid, false);
        if (FORMS[fid] && FORMS[fid].anchor) trackActiveAnchors(true); // 进章节立即按锚点实际位置聚形
        var lbl = ch.labels[Math.min(stage, ch.labels.length - 1)];
        var boxIdx = ['序', '第1盒', '第2盒', '第3盒', '第4盒', '第5盒'][best] || '';
        if (lbl) { st.label = boxIdx + ' · ' + lbl; QF.label = st.label; }
      }
    }

    /* ----- 每帧 ----- */
    function step(now) {
      var dt = Math.min(0.05, (now - st.lastT) / 1000) || 0.016;
      st.lastT = now;
      st.time += dt;
      st.fpsEma = st.fpsEma * 0.92 + (1 / Math.max(0.001, dt)) * 0.08;

      // morph 推进
      if (st.morphT < 1) st.morphT = Math.min(1, st.morphT + dt / 1.7);
      // 锚点跟踪（有锚点的活动形态每 0.3s 对一次位，滚动时粒子跟着锚点走）
      var anchActive = (st.formA && FORMS[st.formA] && FORMS[st.formA].anchor) ||
                       (st.formB && FORMS[st.formB] && FORMS[st.formB].anchor);
      if (anchActive) {
        qrTrackT += dt;
        if (qrTrackT > 0.3) { qrTrackT = 0; trackActiveAnchors(false); }
      }
      // sweep 推进
      if (st.sweepOn && st.sweep < 1) {
        var st2 = (st.time - st.sweepT0 - st.sweepDelay) / st.sweepDur;
        st.sweep = Math.max(0, Math.min(1, st2 * 1.12 - 0.06));
        if (st.sweep >= 1) st.sweepOn = 0;
      }
      // 鼠标能量：悬停保持基础涡流，划过按速度增强，离开窗口衰减
      var mBase = st.pointerOn ? 0.5 : 0;
      var mTgt = Math.max(mBase, Math.min(1, st.mouseSpeed));
      st.mouseE += (mTgt - st.mouseE) * Math.min(1, dt * 3.2);
      st.mouseSpeed *= 0.9;
      // 点击年龄
      if (st.clickAge < 2) st.clickAge += dt;
      // calm（聚形后全场定格成画；悬停=局部流动，快速划动=全场活跃）
      var wantCalm = (st.morphT > 0.95 && st.sweep > 0.98 && st.mouseE < 0.6) ? 0.02 : 1;
      st.calm += (wantCalm - st.calm) * Math.min(1, dt * 2.2);
      if (qrCalmHold > 0) { qrCalmHold -= dt; if (st.calm < 0.9) st.calm = 0.9; } // 二维码跟踪飞行窗口
      // ink 渐变
      st.ink += (st.inkTarget - st.ink) * Math.min(1, dt * 4);
      // trace dy 跟踪
      var dyA = 0, dyB = 0;
      var sy = window.scrollY || 0;
      if (FORMS[st.formA] && FORMS[st.formA].trace) dyA = (sy - (FORMS[st.formA].bakeScrollY || sy)) * px2w;
      if (FORMS[st.formB] && FORMS[st.formB].trace) dyB = (sy - (FORMS[st.formB].bakeScrollY || sy)) * px2w;

      var rA = formAngle(st.formA, dt), rB = formAngle(st.formB, dt);
      velMat.uniforms.uTA.value = formTex[st.formA];
      velMat.uniforms.uTB.value = formTex[st.formB];
      velMat.uniforms.uOffA.value.set(FORMS[st.formA].ox || 0, FORMS[st.formA].oy || 0);
      velMat.uniforms.uOffB.value.set(FORMS[st.formB].ox || 0, FORMS[st.formB].oy || 0);
      velMat.uniforms.uPos.value = rtPos[cur].texture;
      velMat.uniforms.uVel.value = rtVel[cur].texture;
      velMat.uniforms.uTime.value = st.time;
      velMat.uniforms.uDt.value = dt;
      velMat.uniforms.uMorph.value = st.morphT;
      velMat.uniforms.uSweep.value = st.sweep;
      velMat.uniforms.uSweepOn.value = st.sweepOn;
      velMat.uniforms.uMouseE.value = st.mouseE;
      velMat.uniforms.uClick.value.set(st.clickPos[0], st.clickPos[1], st.clickAge);
      velMat.uniforms.uCalm.value = st.calm;
      velMat.uniforms.uRotA.value.set(rA[0], rA[1]);
      velMat.uniforms.uRotB.value.set(rB[0], rB[1]);
      velMat.uniforms.uDyA.value = Math.max(-1.4, Math.min(1.4, dyA));
      velMat.uniforms.uDyB.value = Math.max(-1.4, Math.min(1.4, dyB));

      quad.material = velMat;
      renderer.setRenderTarget(rtVel[1 - cur]);
      renderer.render(simScene, simCam);

      posMat.uniforms.uPos.value = rtPos[cur].texture;
      posMat.uniforms.uVel.value = rtVel[1 - cur].texture;
      posMat.uniforms.uDt.value = dt;
      quad.material = posMat;
      renderer.setRenderTarget(rtPos[1 - cur]);
      renderer.render(simScene, simCam);

      cur = 1 - cur;

      // 渲染粒子
      ptsMat.uniforms.uPos.value = rtPos[cur].texture;
      ptsMat.uniforms.uVel.value = rtVel[cur].texture;
      ptsMat.uniforms.uTA.value = formTex[st.formA];
      ptsMat.uniforms.uTB.value = formTex[st.formB];
      ptsMat.uniforms.uOffA.value.set(FORMS[st.formA].ox || 0, FORMS[st.formA].oy || 0);
      ptsMat.uniforms.uOffB.value.set(FORMS[st.formB].ox || 0, FORMS[st.formB].oy || 0);
      ptsMat.uniforms.uRotA.value.copy(velMat.uniforms.uRotA.value);
      ptsMat.uniforms.uRotB.value.copy(velMat.uniforms.uRotB.value);
      ptsMat.uniforms.uDyA.value = velMat.uniforms.uDyA.value;
      ptsMat.uniforms.uDyB.value = velMat.uniforms.uDyB.value;
      ptsMat.uniforms.uMorph.value = st.morphT;
      ptsMat.uniforms.uInk.value = st.ink;
      ambMat.uniforms.uTime.value = st.time;
      ambMat.uniforms.uInk.value = st.ink;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    /* ----- 定格模式（减少动画偏好） ----- */
    function settle() {
      velMat.uniforms.uTA.value = formTex[st.formA];
      velMat.uniforms.uTB.value = formTex[st.formB];
      velMat.uniforms.uOffA.value.set(FORMS[st.formA].ox || 0, FORMS[st.formA].oy || 0);
      velMat.uniforms.uOffB.value.set(FORMS[st.formB].ox || 0, FORMS[st.formB].oy || 0);
      velMat.uniforms.uPos.value = rtPos[cur].texture;
      velMat.uniforms.uVel.value = rtVel[cur].texture;
      velMat.uniforms.uMorph.value = 1;
      velMat.uniforms.uSweep.value = 1;
      velMat.uniforms.uSweepOn.value = 0;
      velMat.uniforms.uTime.value = st.time;
      velMat.uniforms.uMouseE.value = 0;
      velMat.uniforms.uAspect.value = aspect;
      velMat.uniforms.uIdle.value = 0;
      velMat.uniforms.uCalm.value = 0.1;
      velMat.uniforms.uDt.value = 1 / 40;
      velMat.uniforms.uClick.value.set(0, 0, 99);
      velMat.uniforms.uRotA.value.set((FORMS[st.formA].spinZ || 0) * st.time, (FORMS[st.formA].spinY || 0) * st.time);
      velMat.uniforms.uRotB.value.set((FORMS[st.formB].spinZ || 0) * st.time, (FORMS[st.formB].spinY || 0) * st.time);
      velMat.uniforms.uDyA.value = 0;
      velMat.uniforms.uDyB.value = 0;
      for (var i = 0; i < 80; i++) {
        quad.material = velMat;
        renderer.setRenderTarget(rtVel[1 - cur]);
        renderer.render(simScene, simCam);
        posMat.uniforms.uPos.value = rtPos[cur].texture;
        posMat.uniforms.uVel.value = rtVel[1 - cur].texture;
        posMat.uniforms.uDt.value = 1 / 40;
        quad.material = posMat;
        renderer.setRenderTarget(rtPos[1 - cur]);
        renderer.render(simScene, simCam);
        cur = 1 - cur;
        velMat.uniforms.uPos.value = rtPos[cur].texture;
        velMat.uniforms.uVel.value = rtVel[cur].texture;
      }
      renderOnce();
    }
    function renderOnce() {
      ptsMat.uniforms.uPos.value = rtPos[cur].texture;
      ptsMat.uniforms.uVel.value = rtVel[cur].texture;
      ptsMat.uniforms.uTA.value = formTex[st.formA];
      ptsMat.uniforms.uTB.value = formTex[st.formB];
      ptsMat.uniforms.uOffA.value.set(FORMS[st.formA].ox || 0, FORMS[st.formA].oy || 0);
      ptsMat.uniforms.uOffB.value.set(FORMS[st.formB].ox || 0, FORMS[st.formB].oy || 0);
      ptsMat.uniforms.uMorph.value = st.morphT;
      ptsMat.uniforms.uInk.value = st.ink;
      ptsMat.uniforms.uRotA.value.copy(velMat.uniforms.uRotA.value);
      ptsMat.uniforms.uRotB.value.copy(velMat.uniforms.uRotB.value);
      ptsMat.uniforms.uDyA.value = velMat.uniforms.uDyA.value;
      ptsMat.uniforms.uDyB.value = velMat.uniforms.uDyB.value;
      ambMat.uniforms.uTime.value = st.time;
      ambMat.uniforms.uInk.value = st.ink;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    /* ----- 主循环 ----- */
    var running = false, rafId = 0;
    function loop(now) {
      if (!running) return;
      pickChapter();
      step(now);
      hud(now);
      rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (reduced) { // 定格模式：章节变化时单独渲染
        measure(); pickChapter(); renderOnce();
        return;
      }
      if (running) return;
      running = true;
      st.lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    }
    function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    /* ----- HUD 回调 ----- */
    function hud(now) {
      if (!statsHook || now - st.lastHud < 300) return;
      st.lastHud = now;
      statsHook({
        fps: Math.round(st.fpsEma),
        n: N,
        label: st.label,
        calm: st.calm < 0.5
      });
    }

    /* ----- 重置尺寸 ----- */
    var resizeTimer = 0;
    var bakedAspect = aspect;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        aspect = window.innerWidth / window.innerHeight;
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = aspect; camera.updateProjectionMatrix();
        velMat.uniforms.uAspect.value = aspect;
        ptsMat.uniforms.uAspect.value = aspect;
        ambMat.uniforms.uAspect.value = aspect;
        px2w = W / window.innerHeight;
        measureAnchors();
        if (Math.abs(aspect - bakedAspect) > 0.12) {
          bakedAspect = aspect;
          for (var id in FORMS) buildFormTex(id);
        } else {
          for (var id2 in FORMS) if (FORMS[id2].trace) rebuildTrace(id2);
        }
        measure();
        if (reduced) { pickChapter(); renderOnce(); }
      }, 250);
    });
    window.addEventListener('scroll', function () {
      if (reduced) { measure(); pickChapter(); trackActiveAnchors(false); renderOnce(); }
    }, { passive: true });

    /* ----- 对外 API ----- */
    QF.dbg = function () {
      var out = { formA: st.formA, formB: st.formB, calm: Math.round(st.calm * 100) / 100, morph: Math.round(st.morphT * 100) / 100 };
      for (var id in FORMS) { var f = FORMS[id]; out[id] = f.anchor ? (f.anchor + ' anchored=' + !!f._anchored + ' ox=' + Math.round((f.ox || 0) * 100) / 100 + ' oy=' + Math.round((f.oy || 0) * 100) / 100) : '-'; }
      return out;
    };
    QF.setInk = function (v) {
      st.inkTarget = v ? 1 : 0; st.ink = v ? Math.max(st.ink, 0.15) : Math.min(st.ink, 0.85);
      ptsMat.blending = v ? THREE.NormalBlending : THREE.AdditiveBlending;
      ambMat.blending = v ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (reduced) renderOnce();
    };
    QF.ok = true;

    // 初始入场：爆炸 → 写名（定格模式则直接沉降）
    st.sweepOn = reduced ? 0 : 1;
    st.sweep = reduced ? 1 : 0;
    st.sweepT0 = 0.2;
    st.label = '清风77'; QF.label = '清风77';
    measure();
    // 懒加载图片会撑高布局（照片墙无 aspect-ratio 预留），布局一变就重测章节坐标
    if (window.ResizeObserver) {
      new ResizeObserver(function () { measure(); }).observe(document.body);
    }
    if (reduced) {
      pickChapter();
      settle();
      setTimeout(function () { rebuildTrace('qf77'); rebuildTrace('viva'); rebuildTrace('n77'); settle(); }, 1400);
    } else {
      start();
      setTimeout(function () {
        if (formTex.qf77) { rebuildTrace('qf77'); }
        if (formTex.viva) { rebuildTrace('viva'); }
        if (formTex.n77) { rebuildTrace('n77'); }
      }, 1400);
    }
  }

  // 等字体就绪后启动（保证文字光栅正确）
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { late(fn); });
    else late(fn);
  }
  function late(fn) {
    var done = false;
    function go() { if (!done) { done = true; fn(); } }
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(go);
        setTimeout(go, 1600);
      } else go();
    } catch (e) { go(); }
  }

  QF.init = function () { ready(boot); };
})();
