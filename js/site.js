/* ============================================================
   清风77 · 页面交互
   主题波前切换 / 进场动画 / HUD / 章节圆点 / DOM 二维码
   ============================================================ */
(function () {
  'use strict';

  var html = document.documentElement;
  var veil = document.getElementById('theme-veil');
  var toggle = document.getElementById('theme-toggle');

  /* ---------- 进场动画 ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll('.rv').forEach(function (el) { io.observe(el); });

  /* ---------- 主题切换（圆形波前） ---------- */
  if (toggle) {
    toggle.addEventListener('click', function () {
      var r = toggle.getBoundingClientRect();
      veil.style.setProperty('--vx', (r.left + r.width / 2) + 'px');
      veil.style.setProperty('--vy', (r.top + r.height / 2) + 'px');
      var toLight = html.dataset.theme !== 'light';
      veil.style.background = toLight ? '#F5EEE1' : '#0B0908';
      veil.classList.remove('fade');
      void veil.offsetWidth; // 强制重排以重启动画
      veil.classList.add('grow');
      setTimeout(function () {
        html.dataset.theme = toLight ? 'light' : 'dark';
        if (window.QF && QF.setInk) QF.setInk(toLight ? 1 : 0);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', toLight ? '#F5EEE1' : '#0B0908');
      }, 300);
      setTimeout(function () {
        veil.classList.remove('grow');
        veil.classList.add('fade');
        setTimeout(function () { veil.classList.remove('fade'); }, 520);
      }, 700);
    });
  }

  /* ---------- HUD + 页脚粒子数 ---------- */
  var hudL1 = document.getElementById('hud-line1');
  var hudL2 = document.getElementById('hud-line2');
  var ptsN = document.getElementById('pts-n');
  function fmt(n) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  if (window.QF) {
    QF.onStats(function (s) {
      if (hudL1) hudL1.textContent = '◈ 微光场 · ' + (s.label || '');
      if (hudL2) hudL2.textContent = fmt(s.n) + ' pts · ' + s.fps + ' fps' + (s.calm ? (s.label === '二维码 · 扫我' ? ' · 停稳可扫' : ' · 已定格') : '');
      if (ptsN && s.n) ptsN.textContent = fmt(s.n);
    });
  }

  /* ---------- 章节圆点高亮 ---------- */
  var dotLinks = document.querySelectorAll('.dots a');
  var sections = [];
  var map = { '#top': 'top', '#timeline': 'timeline', '#identity': 'identity', '#hobby': 'hobby', '#life': 'life', '#contact': 'contact' };
  Object.keys(map).forEach(function (sel) {
    var el = document.querySelector(sel);
    if (el) sections.push({ el: el, id: map[sel] });
  });
  function syncDots() {
    var mid = window.scrollY + window.innerHeight / 2, best = null, bd = 1e12;
    sections.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      var top = r.top + window.scrollY, c = top + r.height / 2;
      if (top <= mid && top + r.height >= mid) { best = s.id; bd = -1; }
      else if (bd >= 0) { var d = Math.abs(c - mid); if (d < bd) { bd = d; best = s.id; } }
    });
    dotLinks.forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('href') === '#' + best);
    });
  }
  var dotTick = false;
  window.addEventListener('scroll', function () {
    if (dotTick) return; dotTick = true;
    requestAnimationFrame(function () { syncDots(); dotTick = false; });
  }, { passive: true });
  syncDots();

  /* ---------- 待补链接（视频卡等） ---------- */
  document.querySelectorAll('[data-todo]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      var t = a.querySelector('.card-link') || a.querySelector('.xtit') || a.querySelector('h3') || a.querySelector('figcaption');
      if (t) {
        var old = t.textContent;
        t.textContent = '链接还没补上，先逛逛别的 ↺';
        setTimeout(function () { t.textContent = old; }, 1800);
      }
    });
  });

  /* ---------- 视频卡：补好链接后直接点开看 ---------- */
  document.querySelectorAll('.vcard[data-href]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      window.open(el.getAttribute('data-href'), '_blank', 'noopener');
    });
  });

  /* ---------- 77 体验 · 标签筛选 ---------- */
  var chips = Array.prototype.slice.call(document.querySelectorAll('.fchip'));
  var wcards = Array.prototype.slice.call(document.querySelectorAll('.wcard'));
  if (chips.length && wcards.length) {
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        c.classList.add('on'); c.setAttribute('aria-pressed', 'true');
        var f = c.dataset.f;
        wcards.forEach(function (w) {
          var hit = f === 'all' || (w.dataset.tags || '').split(/\s+/).indexOf(f) >= 0;
          w.classList.toggle('off', !hit);
        });
        var wall = document.getElementById('wall');
        if (wall) { // 触发一次轻快进场
          wall.classList.remove('reflow'); void wall.offsetWidth;
          wall.classList.add('reflow');
        }
      });
    });
  }

  /* ---------- 父女时光 · 灯箱 ---------- */
  var lb = document.getElementById('lightbox');
  var pcards = Array.prototype.slice.call(document.querySelectorAll('.pcard'));
  if (lb && pcards.length) {
    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('figcaption');
    var cur = 0;
    function openLb(i) {
      cur = (i + pcards.length) % pcards.length;
      var img = pcards[cur].querySelector('img');
      lbImg.src = img.src;
      lbImg.alt = img.alt || '';
      lbCap.textContent = pcards[cur].dataset.cap || '';
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function closeLb() {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    pcards.forEach(function (p, i) {
      // 视频卡（带 data-todo / data-href）不走灯箱，走链接/提示
      if (p.hasAttribute('data-todo') || p.hasAttribute('data-href')) return;
      p.setAttribute('tabindex', '0');
      p.addEventListener('click', function () { openLb(i); });
      p.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(i); }
      });
    });
    lb.querySelector('.lb-close').addEventListener('click', closeLb);
    lb.querySelector('.lb-prev').addEventListener('click', function () { openLb(cur - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { openLb(cur + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') openLb(cur - 1);
      else if (e.key === 'ArrowRight') openLb(cur + 1);
    });
  }

  /* ---------- 启动粒子场 ---------- */
  if (window.QF && QF.init) QF.init();

  /* ---------- 横向轮播：按住拖动 ---------- */
  document.querySelectorAll('[data-drag]').forEach(function (el) {
    var down = false, sx = 0, sl = 0, moved = 0;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // 触屏走原生滚动
      down = true; moved = 0; sx = e.clientX; sl = el.scrollLeft;
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      if (Math.abs(dx) > 5) moved = 1;
      el.scrollLeft = sl - dx;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.addEventListener(ev, function () {
        if (!down) return;
        down = false;
        el.classList.remove('dragging');
      });
    });
    el.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = 0; }
    }, true);
  });

})();
