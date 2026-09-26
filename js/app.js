/* Семестр — каркас приложения: маршруты, боковая панель, тема, события, запуск */
(function (App) {
  'use strict';

  const { U, Store, UI, FileDB } = App;
  const { esc, ico } = U;

  const ROUTES = ['home', 'schedule', 'files', 'notifications', 'settings'];
  const TITLES = { home: 'Главная', schedule: 'Расписание', files: 'Файлы', notifications: 'Уведомления', settings: 'Настройки' };
  const hostTheme = window.__hostTheme || null;

  App.views = {
    home: App.Home,
    schedule: App.Schedule,
    files: App.Files,
    notifications: App.Notify,
    settings: App.Settings,
  };
  App.route = 'home';
  App.iconUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#C96442" stroke-width="1.4" opacity=".5"/><circle cx="12" cy="12" r="4.4" fill="#C96442"/><circle cx="21" cy="12" r="2.2" fill="#C96442"/></svg>')}`;

  const $app = () => U.$('#app');
  const $view = () => U.$('#view');
  let enterTimer = null;

  /* ---------- Маршруты ---------- */

  function parseRoute() {
    const h = location.hash.replace(/^#/, '');
    return ROUTES.includes(h) ? h : 'home';
  }

  App.go = (route) => {
    closeSidebar();
    UI.closePopover();
    if (!ROUTES.includes(route)) route = 'home';
    if (location.hash === `#${route}` || (route === 'home' && !location.hash && App.route === 'home')) {
      App.route = route;
      App.renderView(true);
      App.renderSidebar();
    } else {
      location.hash = route;
    }
  };

  App.renderView = (animate) => {
    const view = $view();
    const mod = App.views[App.route];
    const scroll = animate ? 0 : view.scrollTop;
    view.innerHTML = `<div class="view-inner view-${App.route}">${mod.render()}</div>`;
    if (animate) {
      view.classList.remove('enter');
      void view.offsetWidth;
      view.classList.add('enter');
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => view.classList.remove('enter'), 1400);
    }
    view.scrollTop = scroll;
    if (mod.mount) mod.mount(view);
    UI.initSeg(view);
    App.Files.hydrate(view);
    U.$('#topbar-title').textContent = TITLES[App.route];
  };

  App.refresh = () => {
    const view = $view();
    const mod = App.views[App.route];
    if (mod.refresh) {
      mod.refresh(view);
      App.Files.hydrate(view);
    } else {
      App.renderView(false);
    }
    App.renderSidebar();
    App.Notify.updateBadges();
  };

  App.setBusy = (busy) => {
    U.$$('.brand-mark, .greet').forEach((el) => el.classList.toggle('is-busy', busy));
  };

  /* ---------- Боковая панель ---------- */

  App.renderSidebar = () => {
    const st = Store.state;
    const unread = App.Notify.unread();
    const name = (st.profile.name || '').trim();
    const activeSubj = App.route === 'files' ? App.Files.filter.subject : null;
    const item = (route, icon, label, extra = '') => `
      <a class="sb-item ${App.route === route ? 'is-active' : ''}" href="#${route}" data-action="go" data-route="${route}" title="${label}" ${App.route === route ? 'aria-current="page"' : ''}>
        ${ico(icon)}<span class="sb-label">${label}</span>${extra}
      </a>`;
    const subjects = Store.sortedSubjects();

    U.$('#sidebar').innerHTML = `
      <div class="sb-top">
        <button class="brand" data-action="brand" aria-label="${$app().classList.contains('is-collapsed') ? 'Развернуть панель' : 'На главную'}">
          <span class="brand-mark">${U.mark()}<span class="brand-expand">${ico('sidebar')}</span></span>
          <span class="brand-name sb-label">Семестр</span>
        </button>
        <button class="icon-btn sb-collapse sb-label" data-action="toggle-sidebar" aria-label="Свернуть панель" title="Свернуть панель">${ico('sidebar')}</button>
      </div>
      <button class="sb-new" data-action="new-menu" aria-haspopup="menu" aria-expanded="false" title="Добавить">
        <span class="plus">${ico('plus')}</span><span class="sb-label">Добавить</span>
      </button>
      <nav class="sb-nav" aria-label="Разделы">
        ${item('home', 'home', 'Главная')}
        ${item('schedule', 'calendar', 'Расписание')}
        ${item('files', 'folder', 'Файлы', st.files.length ? `<span class="sb-count sb-label">${st.files.length}</span>` : '')}
        ${item('notifications', 'bell', 'Уведомления', unread ? `<span class="sb-badge" id="nav-badge">${unread > 99 ? '99+' : unread}</span>` : '')}
      </nav>
      <div class="sb-section sb-label">
        <div class="sb-heading">Предметы</div>
        ${subjects.length ? subjects.map((s) => `
          <button class="sb-subject ${activeSubj === s.id ? 'is-active' : ''}" data-action="subject-open" data-id="${s.id}" style="--h:${s.hue}" title="Файлы по предмету «${esc(s.name)}»">
            <span class="dot"></span><span class="sb-subject-name">${esc(s.name)}</span>
          </button>`).join('') : '<p class="sb-empty">Появятся, когда вы добавите пары</p>'}
      </div>
      <div class="sb-foot">
        <button class="profile ${App.route === 'settings' ? 'is-active' : ''}" data-action="go" data-route="settings" title="Настройки">
          <span class="avatar">${esc((name || 'С').charAt(0).toUpperCase())}</span>
          <span class="profile-text sb-label"><span class="profile-name">${esc(name || 'Студент')}</span><span class="profile-sub">${esc(Store.profileLine() || 'Настройки')}</span></span>
        </button>
      </div>`;
  };

  function setCollapsed(collapsed) {
    Store.state.settings.sidebarCollapsed = collapsed;
    Store.save();
    $app().classList.toggle('is-collapsed', collapsed);
    App.renderSidebar();
    setTimeout(UI.refreshSegs, 360);
  }

  function openSidebar() { $app().classList.add('sb-open'); }
  function closeSidebar() { $app().classList.remove('sb-open'); }
  const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

  /* ---------- Тема ---------- */

  App.effectiveTheme = () => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  App.applyTheme = () => {
    const t = Store.state.settings.theme;
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
    const dark = App.effectiveTheme() === 'dark';
    const btn = U.$('#theme-btn');
    if (btn) {
      btn.innerHTML = ico(dark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', dark ? 'Светлая тема' : 'Тёмная тема');
      btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
    }
    const meta = U.$('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#262624' : '#F5F3EC');
  };

  /* ---------- Действия ---------- */

  Object.assign(App.actions, {
    go: (el) => App.go(el.dataset.route),
    brand: () => {
      if ($app().classList.contains('is-collapsed') && !isMobile()) setCollapsed(false);
      else App.go('home');
    },
    'toggle-sidebar': () => setCollapsed(!$app().classList.contains('is-collapsed')),
    'open-sidebar': () => openSidebar(),
    'close-sidebar': () => closeSidebar(),
    'theme-toggle': () => {
      Store.state.settings.theme = App.effectiveTheme() === 'dark' ? 'light' : 'dark';
      Store.save();
      App.applyTheme();
      if (App.route === 'settings') App.renderView(false);
    },
    'new-menu': (el) => {
      UI.popover(el, `
        <button class="menu-item" role="menuitem" data-action="class-new">${ico('calendar')}<span>Занятие<span class="menu-sub">В расписание</span></span></button>
        <button class="menu-item" role="menuitem" data-action="rem-new" data-kind="deadline">${ico('flag')}<span>Дедлайн<span class="menu-sub">Отработка, коллоквиум, экзамен</span></span></button>
        <button class="menu-item" role="menuitem" data-action="rem-new">${ico('bell')}<span>Напоминание<span class="menu-sub">Любое дело со сроком</span></span></button>
        <button class="menu-item" role="menuitem" data-action="files-pick">${ico('upload')}<span>Файлы<span class="menu-sub">Конспекты и методички</span></span></button>`,
      { align: 'left', role: 'menu', focusFirst: false });
    },
    'subject-open': (el) => {
      App.Files.filter.subject = el.dataset.id;
      App.Files.filter.q = '';
      if (App.route === 'files') { App.renderView(false); App.renderSidebar(); closeSidebar(); }
      else App.go('files');
    },
  });

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = App.actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    if (el.closest('.popover') && el.dataset.action !== 'notif-read-all') UI.closePopover();
    fn(el, e);
  }

  function onChange(e) {
    const holder = e.target.closest('[data-change]');
    const key = holder ? holder.dataset.change : e.target.name;
    const fn = key && App.changes[key];
    if (fn) fn(holder || e.target, e);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (UI.closePopover()) return;
      if (UI.closeTopModal()) return;
      closeSidebar();
      return;
    }
    // Enter и пробел для элементов с role="button", которые не являются кнопками
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]:not(button)')) {
      e.preventDefault();
      e.target.click();
    }
  }

  /* ---------- Запуск ---------- */

  async function init() {
    Store.load();
    const autoGroup = App.KGMU ? App.KGMU.autoImport() : false;
    App.applyTheme();
    if (Store.state.settings.sidebarCollapsed) $app().classList.add('is-collapsed');
    App.route = parseRoute();

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', () => {
      App.route = parseRoute();
      closeSidebar();
      UI.closePopover();
      App.renderView(true);
      App.renderSidebar();
    });
    U.$('#file-input').addEventListener('change', (e) => App.Files.onPicked(e.target.files));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', App.applyTheme);
    window.addEventListener('resize', U.debounce(UI.refreshSegs, 150));

    App.renderSidebar();
    App.renderView(true);
    App.Notify.updateBadges();
    App.Files.initDrop();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(UI.refreshSegs);

    const dbOk = await FileDB.open();
    if (Store.oldSampleFiles) {
      await Promise.all(Store.oldSampleFiles.map((id) => FileDB.del(id)));
      Store.oldSampleFiles = null;
    }
    if (Store.seedBlobs) {
      for (const { id, blob } of Store.seedBlobs) {
        try { await FileDB.put(id, blob); } catch (e) { /* останется в памяти */ }
      }
      Store.seedBlobs = null;
      App.Files.hydrate($view());
    }
    if (autoGroup) {
      UI.toast(`Загружено расписание группы ${autoGroup}. Дисциплины по выбору можно добавить в настройках`, {
        timeout: 8000,
        action: { label: 'Сменить', fn: () => App.KGMU.openImport(autoGroup) },
      });
    }
    if (!Store.storageOk) {
      UI.toast('Браузер не даёт сохранять данные — изменения пропадут после перезагрузки', { timeout: 8000 });
    } else if (!dbOk) {
      UI.toast('Хранилище файлов недоступно — файлы сохранятся только до перезагрузки страницы', { timeout: 8000 });
    }

    // Планировщик уведомлений и «живые» части экрана
    let lastMinute = new Date().getMinutes();
    const tick = () => {
      App.Notify.tick();
      const m = new Date().getMinutes();
      if (m !== lastMinute) {
        lastMinute = m;
        const mod = App.views[App.route];
        if (mod.onMinute) mod.onMinute($view());
      }
    };
    setInterval(tick, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    setTimeout(tick, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.App);
