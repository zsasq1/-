/* Семестр — движение: пружины и эффекты, перенесённые из библиотек
   Skecher UI (Velocity Tabs), Space UI (Blur Reveal Text, Theme Toggle, Bouncy Accordion),
   Componentry (Hover Transition — блик) и Arc (Toast stack). Без зависимостей. */
(function (App) {
  'use strict';

  const U = App.U;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Пружина ---------- */

  // Полу-неявный Эйлер: устойчив на любых частотах кадров
  function spring(from, to, opts = {}) {
    const k = opts.stiffness || 420;
    const c = opts.damping || 34;
    const m = opts.mass || 0.8;
    let x = from;
    let v = opts.velocity || 0;
    let last = 0;
    let raf = 0;
    let stopped = false;
    const step = (t) => {
      if (stopped) return;
      const dt = last ? Math.min((t - last) / 1000, 1 / 30) : 1 / 60;
      last = t;
      const a = (-k * (x - to) - c * v) / m;
      v += a * dt;
      x += v * dt;
      const done = Math.abs(v) < 0.02 && Math.abs(x - to) < 0.05;
      if (done) { x = to; v = 0; }
      if (opts.onUpdate) opts.onUpdate(x, v);
      if (done) { if (opts.onDone) opts.onDone(); return; }
      raf = requestAnimationFrame(step);
    };
    if (reduced()) {
      if (opts.onUpdate) opts.onUpdate(to, 0);
      if (opts.onDone) opts.onDone();
    } else raf = requestAnimationFrame(step);
    return { stop() { stopped = true; cancelAnimationFrame(raf); }, get value() { return x; }, get velocity() { return v; } };
  }

  /* ---------- Velocity Tabs: бегунок тянется и смазывается в движении ---------- */

  const thumbs = new WeakMap();
  function slideThumb(seg, thumb, x, w, instant) {
    let s = thumbs.get(thumb);
    if (!s) { s = { x, w, anim: null, wAnim: null }; thumbs.set(thumb, s); instant = true; }
    const paint = (vx) => {
      // скорость в «ширинах бегунка в секунду» — как у Velocity Tabs: растяжение до 1.25, размытие до 1.5px
      const speed = Math.min(Math.abs(vx) / Math.max(s.w, 1), 14);
      const scale = 1 + Math.min(0.25, speed * 0.02);
      const blur = Math.min(1.5, speed * 0.11);
      thumb.style.width = `${s.w}px`;
      thumb.style.transform = `translateX(${s.x}px) scaleX(${scale.toFixed(3)})`;
      thumb.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
    };
    if (s.anim) s.anim.stop();
    if (s.wAnim) s.wAnim.stop();
    if (instant || reduced()) { s.x = x; s.w = w; paint(0); return; }
    s.anim = spring(s.x, x, { stiffness: 420, damping: 34, mass: 0.8, onUpdate: (v, vel) => { s.x = v; paint(vel); } });
    s.wAnim = spring(s.w, w, { stiffness: 420, damping: 34, mass: 0.8, onUpdate: (v) => { s.w = v; } });
  }

  /* ---------- Blur Reveal Text: слова проявляются из размытия по очереди ---------- */

  function blurReveal(el, { stagger = 0.05, delay = 0.08 } = {}) {
    if (!el || el.dataset.revealed || reduced()) return;
    el.dataset.revealed = '1';
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/);
          if (parts.length < 2 && !n.textContent.trim()) return;
          const frag = document.createDocumentFragment();
          parts.forEach((p) => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            const span = document.createElement('span');
            span.className = 'br-word';
            span.style.animationDelay = `${(delay + i++ * stagger).toFixed(3)}s`;
            span.textContent = p;
            frag.appendChild(span);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.matches('svg, .ico, .mark')) walk(n);
      });
    };
    walk(el);
  }

  /* ---------- Theme Toggle: новая тема раскрывается кругом от кнопки ---------- */

  function themeReveal(apply, origin) {
    if (!document.startViewTransition || reduced()) { apply(); return; }
    const r = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;
    const x = r ? r.left + r.width / 2 : innerWidth - 40;
    const y = r ? r.top + r.height / 2 : 40;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.classList.add('vt-theme');
    let t;
    try { t = document.startViewTransition(apply); } catch (e) { apply(); document.documentElement.classList.remove('vt-theme'); return; }
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`], filter: ['blur(8px)', 'blur(0px)'] },
        { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
    t.finished.finally(() => document.documentElement.classList.remove('vt-theme'));
  }

  /* ---------- Hover Transition: мягкий блик следует за курсором ---------- */

  function initGlare() {
    if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const SEL = '.card, .cc, .ns, .day, .dc, .set-card, .fcard, .rem, .mini-file, .ai-chip';
    let cur = null;
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest(SEL);
      if (cur && cur !== el) cur.classList.remove('is-glare');
      cur = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--gx', `${e.clientX - r.left}px`);
      el.style.setProperty('--gy', `${e.clientY - r.top}px`);
      el.classList.add('is-glare');
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (cur) cur.classList.remove('is-glare'); cur = null; });
  }

  /* ---------- Bouncy Accordion: раскрытие <details> с пружиной ---------- */

  function initDetails() {
    document.addEventListener('click', (e) => {
      const sum = e.target.closest && e.target.closest('details.day > summary, details.more > summary');
      if (!sum || reduced()) return;
      const det = sum.parentElement;
      const body = det.querySelector(':scope > :not(summary)');
      if (!body || det.dataset.anim) return;
      e.preventDefault();
      det.dataset.anim = '1';
      const opening = !det.open;
      if (opening) det.open = true;
      const h = body.scrollHeight;
      body.style.overflow = 'hidden';
      const a = body.animate(
        opening
          ? [{ height: '0px', opacity: 0, transform: 'translateY(-6px)' }, { height: `${h}px`, opacity: 1, transform: 'none' }]
          : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: opening ? 520 : 260, easing: opening ? 'cubic-bezier(.34, 1.3, .64, 1)' : 'cubic-bezier(.4, 0, .2, 1)' },
      );
      a.onfinish = a.oncancel = () => {
        body.style.overflow = '';
        if (!opening) det.open = false;
        delete det.dataset.anim;
      };
    });
  }

  /* ---------- Toast stack: подсказки складываются стопкой, на наведение раскрываются ---------- */

  function stackToasts(root) {
    if (!root) return;
    const list = Array.from(root.children).filter((t) => !t.classList.contains('is-out'));
    // на телефоне наведения нет — стопка всегда собрана, видна свежая подсказка
    const expanded = root.matches(':hover') && window.matchMedia('(hover: hover)').matches;
    let offset = 0;
    const front = list[list.length - 1];
    if (front) front.style.height = '';
    const frontH = front ? front.offsetHeight : 0;
    for (let i = list.length - 1, n = 0; i >= 0; i--, n++) {
      const t = list[i];
      if (expanded) {
        t.style.height = '';
        t.classList.remove('is-behind');
        const h = t.offsetHeight;
        t.style.transform = `translateY(${-offset}px)`;
        t.style.opacity = '1';
        offset += h + 8;
      } else {
        // задние подсказки — той же высоты, что и передняя, и без текста: видны только краешки
        if (n) { t.style.height = `${frontH}px`; t.classList.add('is-behind'); } else t.classList.remove('is-behind');
        t.style.transform = `translateY(${-n * 10}px) scale(${(1 - n * 0.05).toFixed(3)})`;
        t.style.opacity = n > 2 ? '0' : String(1 - n * 0.15);
      }
      t.style.zIndex = String(100 - n);
      t.style.pointerEvents = expanded || n === 0 ? '' : 'none';
    }
    root.style.height = `${expanded ? Math.max(offset - 8, 0) : (list.length ? list[list.length - 1].offsetHeight + Math.min(list.length - 1, 2) * 10 : 0)}px`;
  }

  function initToasts() {
    const root = document.getElementById('toasts');
    if (!root) return;
    root.classList.add('is-stack');
    const relayout = () => requestAnimationFrame(() => stackToasts(root));
    new MutationObserver(relayout).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    root.addEventListener('pointerenter', relayout);
    root.addEventListener('pointerleave', relayout);
    window.addEventListener('resize', U.debounce(relayout, 150));
  }

  /* ---------- Letter Cascade (Componentry): буквы переворачиваются снизу на пружине ----------
     Исходник — React + Motion; здесь те же параметры: пружина stiffness 220 / damping 16,
     шаг 40 мс, каждая буква: rotateX -90° → 0, y 6 → 0, scale .8 → 1, blur 4px → 0.
     Текст дописывается по мере ответа: новые буквы встают в очередь за уже идущими. */

  // Пружину переводим в CSS-кривую linear(): браузер играет её сам, без JS на каждую букву
  const springEase = (() => {
    const k = 220, c = 16, m = 1;
    let x = 0, v = 0;
    const pts = [];
    const dt = 1 / 600;
    let t = 0;
    for (; t < 2; t += dt) {
      const a = (-k * (x - 1) - c * v) / m;
      v += a * dt; x += v * dt;
      pts.push(x);
      if (t > 0.2 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
    }
    const dur = Math.round(t * 1000);
    const step = Math.max(1, Math.floor(pts.length / 48));
    const out = [0];
    for (let i = step; i < pts.length; i += step) out.push(+pts[i].toFixed(4));
    out.push(1);
    const css = `linear(${out.join(', ')})`;
    const ok = window.CSS && CSS.supports && CSS.supports('animation-timing-function', css);
    return { css: ok ? css : 'cubic-bezier(.34, 1.56, .64, 1)', dur: ok ? dur : 650 };
  })();
  document.documentElement.style.setProperty('--lc-ease', springEase.css);
  document.documentElement.style.setProperty('--lc-dur', `${springEase.dur}ms`);

  function cascade(el, text) {
    let st = el._lc;
    if (!st || !String(text).startsWith(st.src)) {
      el.textContent = '';
      st = el._lc = { src: '', hold: '', bold: false, head: false, lineStart: true, word: null, wordLen: 0, nextAt: 0, endsAt: 0, done: false };
    }
    const delta = String(text).slice(st.src.length);
    st.src = String(text);
    feed(el, st, delta, false);
    return st;
  }

  function cascadeFinish(el) {
    const st = el && el._lc;
    if (!st || st.done) return st;
    st.done = true;
    feed(el, st, '', true);
    return st;
  }

  function feed(el, st, delta, final) {
    let s = st.hold + delta;
    st.hold = '';
    if (!final) {
      // «**», «- » и «#» в начале строки могут прийти по частям — ждём следующий кусок
      const tail = s.match(/\*+$/) || (st.lineStart || /\n[#\-*]*$/.test(s) ? s.match(/(^|\n)([#\-*]+)$/) : null);
      if (tail) { const t = tail[0].replace(/^\n/, ''); st.hold = t; s = s.slice(0, s.length - t.length); }
    }
    const now = performance.now();
    const letters = [];
    const frag = document.createDocumentFragment();
    const closeWord = () => { st.word = null; st.wordLen = 0; };
    const put = (node) => frag.appendChild(node);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '*' && s[i + 1] === '*') { st.bold = !st.bold; i++; continue; }
      if (st.lineStart) {
        if (ch === '#') { while (s[i + 1] === '#') i++; if (s[i + 1] === ' ') i++; st.head = true; continue; }
        if ((ch === '-' || ch === '*') && s[i + 1] === ' ') { i++; closeWord(); const b = document.createElement('span'); b.className = 'lc-l'; b.textContent = '•'; letters.push(b); put(b); put(document.createTextNode(' ')); st.lineStart = false; continue; }
      }
      if (ch === '\n') { closeWord(); put(document.createElement('br')); st.lineStart = true; st.head = false; continue; }
      st.lineStart = false;
      if (ch === ' ' || ch === '\t') { closeWord(); put(document.createTextNode(' ')); continue; }
      // буквы одного слова держим вместе, чтобы строка переносилась только между словами
      if (!st.word || (!st.word.isConnected && !frag.contains(st.word))) {
        st.word = document.createElement('span');
        st.word.className = 'lc-w';
        put(st.word);
        st.wordLen = 0;
      }
      if (st.wordLen > 28) st.word.classList.add('is-long');
      const l = document.createElement('span');
      l.className = (st.bold || st.head) ? 'lc-l is-b' : 'lc-l';
      l.textContent = ch;
      st.word.appendChild(l);
      st.wordLen++;
      letters.push(l);
    }
    if (frag.childNodes.length) el.appendChild(frag);
    if (!letters.length) return;
    // шаг 40 мс, но длинный ответ не тянем дольше ~1,6 с; при отставании от потока ускоряемся
    let start = Math.max(now, st.nextAt);
    const backlog = start - now;
    const stepMs = backlog > 600 ? 8 : Math.max(5, Math.min(40, 1600 / letters.length));
    if (reduced()) { letters.forEach((l) => l.classList.add('is-in')); return; }
    letters.forEach((l, i) => {
      l.style.animationDelay = `${Math.round(start - now + i * stepMs)}ms`;
    });
    st.nextAt = start + letters.length * stepMs;
    st.endsAt = st.nextAt + springEase.dur;
  }

  App.Motion = {
    spring, slideThumb, blurReveal, themeReveal, stackToasts, reduced, cascade, cascadeFinish,
    init() { initGlare(); initDetails(); initToasts(); },
  };
})(window.App);
