/* Семестр — приложение на телефоне: установка, работа без интернета, обновления */
(function (App) {
  'use strict';

  const { U, UI } = App;

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);

  const PWA = {
    supported: 'serviceWorker' in navigator && secure,
    reg: null,
    deferred: null,      // событие beforeinstallprompt — можно показать системное окно установки
    offlineReady: false,

    standalone() {
      return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    },

    ios() {
      return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    mobile() {
      return window.matchMedia('(pointer: coarse)').matches;
    },

    // Как установить в этом браузере: 'installed' | 'prompt' | 'ios' | 'menu' | 'unavailable'
    installMode() {
      if (this.standalone()) return 'installed';
      if (this.deferred) return 'prompt';
      if (!this.supported) return 'unavailable';
      if (this.ios()) return 'ios';
      return 'menu';
    },

    async init() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferred = e;
        this.rerender();
      });
      window.addEventListener('appinstalled', () => {
        this.deferred = null;
        UI.toast('Семестр установлен — ищите значок на главном экране');
        this.rerender();
      });
      window.addEventListener('online', () => this.network(true));
      window.addEventListener('offline', () => this.network(false));
      this.network(navigator.onLine);

      if (!this.supported) return;
      try {
        this.reg = await navigator.serviceWorker.register('sw.js');
      } catch (e) {
        this.supported = false; // например, в режиме предпросмотра, где воркеры запрещены
        return;
      }
      await navigator.serviceWorker.ready;
      this.offlineReady = true;
      this.rerender();

      // Новая версия ставится сама и включается при следующем открытии — без всплывающих предложений
      if (this.reg.waiting) this.reg.waiting.postMessage('skip-waiting');
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'open-notification' && e.data.id) App.Notify.openItem(e.data.id);
      });
      // Проверяем, не вышла ли новая версия, при возвращении в приложение и раз в час
      const check = () => { if (navigator.onLine) this.reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 36e5);
    },

    async install() {
      const mode = this.installMode();
      if (mode === 'prompt') {
        const e = this.deferred;
        this.deferred = null;
        e.prompt();
        try { await e.userChoice; } catch (err) { /* окно закрыли */ }
        this.rerender();
        return;
      }
      this.showHowTo(mode);
    },

    showHowTo(mode) {
      const steps = {
        ios: ['Откройте сайт в Safari.', 'Нажмите «Поделиться» — квадрат со стрелкой вверх внизу экрана.', 'Выберите «На экран „Домой“» и нажмите «Добавить».'],
        menu: ['Откройте меню браузера (⋮ или ⋯).', 'Выберите «Установить приложение» или «Добавить на главный экран».', 'Подтвердите установку.'],
        unavailable: ['Установка работает, когда сайт открыт по адресу https — например, с GitHub Pages.', 'Откройте такой адрес в Chrome на Android или в Safari на iPhone и повторите.'],
        installed: ['Семестр уже установлен и открыт как приложение.'],
      }[mode] || [];
      UI.modal({
        title: 'Установить на телефон',
        size: 'small',
        focus: 'none',
        body: `<ol class="howto">${steps.map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol>
          <p class="field-hint">После установки Семестр открывается со значка на главном экране, без адресной строки, и работает без интернета.</p>`,
        foot: '<button class="btn btn-primary" type="button" data-close>Понятно</button>',
      });
    },

    // Без интернета просто показываем метку «Офлайн» — всё и так сохраняется на устройстве
    network(online) {
      const pill = U.$('#net-pill');
      if (pill) pill.hidden = online;
    },

    // Системное уведомление: через воркер, если он есть (на Android обычный способ не работает)
    notify(title, opts) {
      if (this.reg && this.reg.showNotification) {
        return this.reg.showNotification(title, Object.assign({ icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png' }, opts))
          .then(() => true, () => false);
      }
      return Promise.resolve(false);
    },

    rerender() {
      if (App.route === 'settings') App.renderView(false);
      else if (App.route === 'home') App.refresh();
    },
  };

  App.actions['pwa-install'] = () => PWA.install();

  App.PWA = PWA;
})(window.App);
