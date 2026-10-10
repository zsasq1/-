/* Семестр — интерфейсные примитивы: тосты, модальные окна, поповеры, переключатели */
(function (App) {
  'use strict';

  const U = App.U;
  const { esc, ico } = U;

  const modals = [];
  let pop = null;
  let modalSeq = 0;

  const KIND_ICON = { class: 'calendar', reminder: 'bell', deadline: 'flag', file: 'file' };

  const UI = {
    kindIcon(kind) {
      return kind === 'system' ? U.mark() : ico(KIND_ICON[kind] || 'bell');
    },

    /* ---------- Тосты ---------- */

    toast(text, opts = {}) {
      const root = U.$('#toasts');
      const el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.innerHTML = `<span class="toast-text">${esc(text)}</span>${opts.action ? `<button class="toast-btn" type="button">${esc(opts.action.label)}</button>` : ''}`;
      return mountToast(root, el, opts.timeout || (opts.action ? 6000 : 3600), (close) => {
        if (opts.action) {
          el.querySelector('.toast-btn').addEventListener('click', () => { opts.action.fn(); close(); });
        }
      });
    },

    notifyToast(n, onOpen) {
      const root = U.$('#toasts');
      const el = document.createElement('div');
      el.className = 'toast toast-rich';
      el.setAttribute('role', 'alert');
      el.innerHTML = `
        <span class="notif-ico k-${esc(n.kind)}">${UI.kindIcon(n.kind)}</span>
        <div class="notif-main"><div class="toast-title">${esc(n.title)}</div>${n.body ? `<div class="toast-body">${esc(n.body)}</div>` : ''}</div>
        <button class="icon-btn sm" type="button" aria-label="Закрыть">${ico('x')}</button>`;
      return mountToast(root, el, 8000, (close) => {
        el.querySelector('.icon-btn').addEventListener('click', (e) => { e.stopPropagation(); close(); });
        el.addEventListener('click', () => { if (onOpen) onOpen(); close(); });
      });
    },

    /* ---------- Модальные окна ---------- */

    modal({ title, body, foot = '', size = '', onMount, onClose, focus = 'auto' }) {
      const id = `m${++modalSeq}`;
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal ${size ? `is-${size}` : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
          <div class="modal-head">
            <h2 class="modal-title" id="${id}-t">${esc(title)}</h2>
            <button class="icon-btn" type="button" data-close aria-label="Закрыть">${ico('x')}</button>
          </div>
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
        </div>`;
      U.$('#modal-root').appendChild(back);
      UI.closePopover();

      const prevFocus = document.activeElement;
      const el = back.querySelector('.modal');
      let closed = false;
      const api = {
        el,
        close() {
          if (closed) return;
          closed = true;
          const i = modals.indexOf(api);
          if (i >= 0) modals.splice(i, 1);
          back.classList.add('is-closing');
          setTimeout(() => back.remove(), 220);
          if (onClose) onClose();
          if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
        },
      };
      modals.push(api);

      back.addEventListener('mousedown', (e) => { if (e.target === back) api.close(); });
      U.$$('[data-close]', back).forEach((b) => b.addEventListener('click', () => api.close()));
      el.addEventListener('keydown', (e) => trapFocus(e, el));

      UI.initSeg(el);
      if (onMount) onMount(el, api);
      setTimeout(() => {
        // На телефоне не ставим курсор в поле сами — иначе сразу выезжает клавиатура
        const touch = window.matchMedia('(pointer: coarse)').matches;
        let f = el.querySelector('[autofocus]');
        if (!f && focus !== 'none' && !touch) {
          f = el.querySelector('.modal-body input:not([type=radio]):not([type=hidden]), .modal-body select, .modal-body textarea')
            || el.querySelector('.modal-foot .btn-primary, .modal-foot .btn-danger-solid');
        }
        if (!f) { el.setAttribute('tabindex', '-1'); f = el; }
        f.focus({ preventScroll: true });
      }, 80);
      return api;
    },

    confirm({ title, text, ok = 'Удалить', cancel = 'Отмена', danger = true }) {
      return new Promise((resolve) => {
        let result = false;
        UI.modal({
          title,
          size: 'small',
          body: `<p class="modal-text">${esc(text)}</p>`,
          foot: `<button class="btn btn-ghost" type="button" data-close>${esc(cancel)}</button>
                 <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" type="button" data-ok>${esc(ok)}</button>`,
          onMount(el, api) {
            el.querySelector('[data-ok]').addEventListener('click', () => { result = true; api.close(); });
          },
          onClose() { resolve(result); },
        });
      });
    },

    closeTopModal() {
      const top = modals[modals.length - 1];
      if (top) { top.close(); return true; }
      return false;
    },

    hasModal() { return modals.length > 0; },

    /* ---------- Поповеры ---------- */

    popover(anchor, html, opts = {}) {
      if (pop && pop.anchor === anchor) { UI.closePopover(); return null; }
      UI.closePopover();
      const el = document.createElement('div');
      el.className = `popover ${opts.className || ''}`;
      el.setAttribute('role', opts.role || 'dialog');
      el.innerHTML = html;
      document.body.appendChild(el);

      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = opts.align === 'left' ? r.left : r.right - w;
      left = U.clamp(left, 8, vw - w - 8);
      let top = r.bottom + 6;
      if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      if (opts.align === 'left') el.classList.add('from-left');

      const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) UI.closePopover(); };
      setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
      anchor.setAttribute('aria-expanded', 'true');

      pop = {
        el, anchor,
        close() {
          document.removeEventListener('pointerdown', onDown);
          anchor.setAttribute('aria-expanded', 'false');
          el.classList.add('is-out');
          setTimeout(() => el.remove(), 160);
        },
      };
      if (opts.onMount) opts.onMount(el);
      const first = el.querySelector('.menu-item');
      if (first && opts.focusFirst) first.focus({ preventScroll: true });
      return el;
    },

    closePopover() {
      if (!pop) return false;
      const p = pop;
      pop = null;
      p.close();
      return true;
    },

    /* ---------- Сегментированный переключатель ---------- */

    seg(prefix, name, options, selected, cls = '') {
      const items = Object.entries(options).map(([value, label]) => {
        const id = `${prefix}-${value}`;
        return `<input type="radio" id="${id}" name="${name}" value="${esc(value)}" ${String(value) === String(selected) ? 'checked' : ''}><label for="${id}">${label}</label>`;
      }).join('');
      return `<div class="seg ${cls}" role="radiogroup"><span class="seg-thumb" aria-hidden="true"></span>${items}</div>`;
    },

    initSeg(root) {
      U.$$('.seg', root || document).forEach((seg) => {
        if (!seg.dataset.ready) {
          seg.dataset.ready = '1';
          seg.addEventListener('change', () => placeThumb(seg));
          seg.classList.add('no-anim');
          placeThumb(seg);
          requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.remove('no-anim')));
        } else {
          placeThumb(seg);
        }
      });
    },

    refreshSegs() {
      U.$$('.seg').forEach((seg) => {
        seg.classList.add('no-anim');
        placeThumb(seg);
        requestAnimationFrame(() => seg.classList.remove('no-anim'));
      });
    },
  };

  function placeThumb(seg) {
    const thumb = seg.querySelector('.seg-thumb');
    const input = seg.querySelector('input:checked');
    const label = input && seg.querySelector(`label[for="${input.id}"]`);
    if (!thumb) return;
    if (!label || !label.offsetWidth) { thumb.style.opacity = label ? '' : '0'; return; }
    thumb.style.opacity = '1';
    // пружина с растяжением и смазом, как у Velocity Tabs (Skecher UI)
    if (App.Motion) App.Motion.slideThumb(seg, thumb, label.offsetLeft, label.offsetWidth, seg.classList.contains('no-anim'));
    else {
      thumb.style.width = `${label.offsetWidth}px`;
      thumb.style.transform = `translateX(${label.offsetLeft}px)`;
    }
  }

  function mountToast(root, el, timeout, bind) {
    root.appendChild(el);
    while (root.children.length > 4) root.firstElementChild.remove();
    let t = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(t);
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 300);
    };
    const arm = (ms) => { clearTimeout(t); t = setTimeout(close, ms); };
    arm(timeout);
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => arm(2200));
    bind(close);
    return { close };
  }

  function trapFocus(e, el) {
    if (e.key !== 'Tab') return;
    const items = U.$$('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', el)
      .filter((x) => !x.disabled && x.offsetParent !== null && !(x.type === 'radio' && !x.checked));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  App.UI = UI;
})(window.App);
