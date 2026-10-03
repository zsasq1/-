/* Семестр — настройки: профиль, тема, уведомления, учебный план, данные */
(function (App) {
  'use strict';

  const { U, Store, UI, FileDB } = App;
  const { esc, ico } = U;

  const CLASS_LEADS = { 0: 'Не напоминать', 5: 'За 5 минут', 10: 'За 10 минут', 15: 'За 15 минут', 30: 'За 30 минут', 60: 'За час' };

  const Settings = {
    render() {
      const st = Store.state;
      const s = st.settings;
      const p = App.Schedule.parity(new Date());
      const sysOn = s.systemNotify && 'Notification' in window && Notification.permission === 'granted';
      const row = (label, desc, control, extra = '') => `
        <div class="set-row">
          <div class="set-text"><div class="set-label ${extra}">${label}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div>
          <div class="set-control">${control}</div>
        </div>`;

      return `
        <div class="page-head rise" style="--i:0">
          <div>
            <h1 class="page-title">Настройки</h1>
            <p class="page-sub">${App.Cloud && App.Cloud.on() ? 'Данные сохраняются в вашем аккаунте Claude' : 'Все данные хранятся только в этом браузере'}</p>
          </div>
        </div>
        <div class="settings">
          <section class="set-group rise" style="--i:1">
            <h2>Профиль</h2>
            <div class="set-card">
              ${row('Как к вам обращаться', 'Имя появится в приветствии на главной',
                `<input id="set-name" class="input" placeholder="Имя" maxlength="40" value="${esc(st.profile.name)}">`)}
            </div>
          </section>

          <section class="set-group rise" style="--i:2">
            <h2>Учёба</h2>
            <div class="set-card">
              ${row('Вуз и специальность', 'Показываются в боковой панели',
                `<input id="set-uni" class="input" placeholder="Вуз" value="${esc(st.profile.university || '')}">
                 <input id="set-program" class="input" placeholder="Специальность" value="${esc(st.profile.program || '')}">`)}
              ${App.KGMU && App.KGMU.available() ? row('Группа',
                App.KGMU.hasImported()
                  ? `Загружено расписание группы ${esc(st.profile.group)}. Дисциплины по выбору: ${esc((st.settings.electiveCourses || []).join(', ') || 'не выбраны')}. Здесь же можно отметить остальные курсы по выбору.`
                  : 'Выберите группу, чтобы загрузить официальное расписание.',
                `<button class="btn btn-primary" data-action="kgmu-import">${ico('calendar')} ${App.KGMU.hasImported() ? 'Сменить или обновить' : 'Выбрать группу'}</button>`) : ''}
              ${App.KGMU ? row('Файл расписания',
                `${App.KGMU.parsed() && App.KGMU.parsed().custom ? 'Используется файл, который вы загрузили.' : 'Встроена версия от 2 сентября 2026.'} Если на <a class="link" href="${esc(App.KGMU_DATA.page)}" target="_blank" rel="noopener">странице лечебного факультета</a> вышла новая, скачайте .xlsx своего потока и загрузите сюда.`,
                `<button class="btn" data-action="kgmu-upload">${ico('upload')} Загрузить .xlsx</button>
                 ${App.KGMU.parsed() && App.KGMU.parsed().custom ? `<button class="btn btn-ghost" data-action="kgmu-reset-data">Вернуть встроенный</button>` : ''}`) : ''}
              ${row('Как называть недели', 'В КГМУ — «1 неделя» и «2 неделя», в других вузах — числитель и знаменатель',
                UI.seg('wn', 'week-names', { num: '1 и 2 неделя', frac: 'Числитель' }, s.weekNames || 'num'))}
            </div>
          </section>

          <section class="set-group rise" style="--i:3">
            <h2>Оформление</h2>
            <div class="set-card">
              ${row('Тема', 'Тёплая светлая, тёмная или как в системе',
                UI.seg('st', 'theme', { light: 'Светлая', dark: 'Тёмная', system: 'Системная' }, s.theme))}
            </div>
          </section>

          <section class="set-group rise" style="--i:4">
            <h2>Уведомления</h2>
            <div class="set-card">
              ${row('Напоминать о паре', 'Уведомление появится перед началом занятия',
                `<select id="set-lead" class="input">${Object.entries(CLASS_LEADS).map(([v, l]) => `<option value="${v}" ${Number(v) === Number(s.classLead) ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
              ${row('Системные уведомления', `${App.Notify.permissionText()}. Приходят, пока сайт открыт во вкладке браузера.`,
                `<label class="switch"><input type="checkbox" id="set-sys" ${sysOn ? 'checked' : ''} aria-label="Системные уведомления"><span></span></label>`)}
              ${row('Проверка', 'Покажет пример уведомления о паре',
                `<button class="btn" data-action="notif-test">${ico('bell')} Отправить тестовое</button>`)}
            </div>
          </section>

          <section class="set-group rise" style="--i:5">
            <h2>Учебный план</h2>
            <div class="set-card">
              ${row('Начало семестра', `Неделя с этой датой — ${esc(App.Schedule.weekName(true))}. Сейчас ${esc(App.Schedule.weekLabel(p))}, ${esc(App.Schedule.weekName(p.odd))}.`,
                `<input id="set-start" type="date" class="input" value="${esc(s.semesterStart)}">`)}
              ${App.Calendar ? row('Календарь телефона',
                `Все занятия с темами и дедлайны — в календарь iPhone, Android или Google.${s.calExportedAt ? ` Последний раз добавляли ${esc(U.fmtDate(new Date(s.calExportedAt)))}; если расписание поменялось, добавьте заново.` : ''}`,
                `<button class="btn" data-action="cal-export">${ico('calendar-plus')} Добавить</button>`) : ''}
              ${row('Показывать воскресенье', 'Если занятия бывают и в воскресенье',
                `<label class="switch"><input type="checkbox" id="set-sun" ${s.showSunday ? 'checked' : ''} aria-label="Показывать воскресенье"><span></span></label>`)}
            </div>
          </section>

          ${this.appSection(row)}

          <section class="set-group rise" style="--i:7">
            <h2>Данные</h2>
            <div class="set-card">
              ${App.Cloud ? `
                <div class="set-row">
                  <div class="set-text"><div class="set-label">${App.Cloud.available() ? 'Сохранение в аккаунте' : 'Где хранятся данные'}</div><div class="set-desc" id="cloud-desc">${App.Cloud.describe()}</div></div>
                  <div class="set-control" id="cloud-status">${App.Cloud.pill()}</div>
                </div>` : ''}
              ${row('Резервная копия', 'Расписание, дела и настройки в файле JSON. Сами файлы в копию не входят.',
                `<button class="btn" data-action="data-export">${ico('download')} Скачать</button>
                 <button class="btn" data-action="data-import">${ico('upload')} Восстановить</button>`)}
              ${Store.hasSample() ? row('Пример', 'Убрать демонстрационные пары, дела и файлы, оставив ваши',
                `<button class="btn" data-action="sample-clear">Очистить пример</button>`) : ''}
              ${row('Удалить всё', `Сотрёт расписание, дела, уведомления и файлы ${App.Cloud && App.Cloud.on() ? 'в аккаунте и на всех устройствах' : 'в этом браузере'}`,
                `<button class="btn btn-danger" data-action="data-reset">${ico('trash')} Удалить всё</button>`, 'danger-text')}
            </div>
          </section>
        </div>`;
    },

    appSection(row) {
      const P = App.PWA;
      if (!P) return '';
      const mode = P.installMode();
      const installDesc = {
        installed: 'Семестр установлен и открыт как приложение.',
        prompt: 'Появится значок на главном экране; открывается без адресной строки, как обычное приложение.',
        ios: 'На iPhone: «Поделиться» → «На экран „Домой“» в Safari.',
        menu: 'Через меню браузера: «Установить приложение» или «Добавить на главный экран».',
        unavailable: 'Установка работает, когда сайт открыт по адресу https — например, с GitHub Pages.',
      }[mode];
      const installBtn = mode === 'installed'
        ? `<span class="pill accent">${ico('check')} Установлено</span>`
        : `<button class="btn ${mode === 'prompt' ? 'btn-primary' : ''}" data-action="pwa-install">${ico('download')} ${mode === 'prompt' ? 'Установить' : 'Как установить'}</button>`;
      const offlineDesc = P.offlineReady
        ? 'Готово: расписание, темы, дела и файлы открываются и без интернета. Новые версии скачиваются сами — появится кнопка «Обновить».'
        : P.supported ? 'Сохраняем сайт на устройство — это займёт несколько секунд.' : 'Недоступно в этом режиме просмотра: нужен адрес https.';
      return `
          <section class="set-group rise" style="--i:6">
            <h2>Приложение</h2>
            <div class="set-card">
              ${row('Установить на телефон', installDesc, installBtn)}
              ${row('Работа без интернета', offlineDesc, P.offlineReady ? `<span class="pill accent">${ico('check')} Включено</span>` : '<span class="pill">Выключено</span>')}
            </div>
          </section>`;
    },

    mount(view) {
      const st = Store.state;
      const name = U.$('#set-name', view);
      const saveName = U.debounce(() => { Store.save(); App.renderSidebar(); }, 300);
      name.addEventListener('input', () => { st.profile.name = name.value.trim(); saveName(); });
      [['#set-uni', 'university'], ['#set-program', 'program']].forEach(([sel, key]) => {
        const input = U.$(sel, view);
        input.addEventListener('input', () => { st.profile[key] = input.value.trim(); saveName(); });
      });

      U.$('#set-lead', view).addEventListener('change', (e) => {
        st.settings.classLead = Number(e.target.value);
        Store.save();
        UI.toast(st.settings.classLead ? `Напомним ${CLASS_LEADS[st.settings.classLead].toLowerCase()} до пары` : 'Напоминания о парах выключены');
      });

      U.$('#set-sys', view).addEventListener('change', async (e) => {
        if (e.target.checked) {
          const ok = await App.Notify.enableSystem();
          e.target.checked = ok;
        } else {
          st.settings.systemNotify = false;
          Store.save();
          UI.toast('Системные уведомления выключены');
        }
        App.renderView(false);
      });

      U.$('#set-start', view).addEventListener('change', (e) => {
        if (!e.target.value) return;
        st.settings.semesterStart = e.target.value;
        Store.save();
        App.renderView(false);
        const np = App.Schedule.parity(new Date());
        UI.toast(`Сейчас ${App.Schedule.weekLabel(np)}, ${App.Schedule.weekName(np.odd)}`);
      });

      U.$('#set-sun', view).addEventListener('change', (e) => {
        st.settings.showSunday = e.target.checked;
        Store.save();
      });
    },

    // Экран настроек не зависит от живых данных — не перерисовываем, чтобы не сбить ввод
    refresh() {},

    async exportData() {
      const data = JSON.stringify(Object.assign({}, Store.state, { exportedAt: new Date().toISOString(), app: 'semestr' }), null, 2);
      const res = await U.saveFile(data, `semestr-${U.ymd(new Date())}.json`, 'application/json');
      if (res === 'saved') UI.toast('Резервная копия скачана');
      else if (res === 'blocked') UI.toast('Здесь сохранить файл нельзя — откройте Семестр на сайте');
    },

    importData() {
      App.Files.pick(async (list) => {
        const file = list[0];
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
        if (!data || !Array.isArray(data.classes) || !Array.isArray(data.reminders)) {
          UI.toast('Это не резервная копия Семестра — выберите файл semestr-….json');
          return;
        }
        const ok = await UI.confirm({
          title: 'Восстановить из копии?',
          text: 'Текущее расписание, дела и настройки заменятся данными из файла. Загруженные файлы останутся на месте.',
          ok: 'Восстановить', danger: false,
        });
        if (!ok) return;
        const files = Store.state.files;
        const next = Store.normalize(data);
        next.files = files;
        // Предметы файлов должны сохраниться, даже если в копии их нет
        files.forEach((f) => {
          if (f.subjectId && !next.subjects.some((s) => s.id === f.subjectId)) {
            const old = Store.subject(f.subjectId);
            if (old) next.subjects.push(old);
          }
        });
        delete next.exportedAt;
        delete next.app;
        Store.state = next;
        if (App.KGMU) App.KGMU._parsed = null;
        Store.save();
        App.applyTheme();
        App.renderSidebar();
        App.renderView(true);
        UI.toast('Данные восстановлены');
      }, 'application/json,.json');
    },

    async resetAll() {
      const cloud = App.Cloud && App.Cloud.on();
      const ok = await UI.confirm({
        title: 'Удалить все данные?',
        text: `Расписание, дела, уведомления и файлы будут удалены ${cloud ? 'из аккаунта и со всех устройств' : 'из этого браузера'} без возможности восстановления.`,
        ok: 'Удалить всё',
      });
      if (!ok) return;
      if (App.Cloud) Store.state.files.forEach((f) => App.Cloud.deleteAsset(f.assetId));
      await FileDB.clear();
      if (App.KGMU) App.KGMU._parsed = null;
      const theme = Store.state.settings.theme;
      Store.state = Store.defaults();
      Store.state.settings.theme = theme;
      Store.state.settings.autoImported = true;
      Store.state.settings.electivesSynced = true;
      Store.state.settings.cloudWelcomed = true;
      Store.save();
      App.go('home');
      UI.toast('Все данные удалены');
    },

    async clearSample() {
      const st = Store.state;
      const sampleFiles = st.files.filter((f) => f.sample);
      st.classes = st.classes.filter((c) => !c.sample);
      st.reminders = st.reminders.filter((r) => !r.sample);
      st.files = st.files.filter((f) => !f.sample);
      st.sampleBanner = false;
      Store.gcSubjects();
      Store.save();
      await Promise.all(sampleFiles.map((f) => FileDB.del(f.id)));
      if (App.Cloud) sampleFiles.forEach((f) => App.Cloud.deleteAsset(f.assetId));
      App.refresh();
      if (App.route === 'settings') App.renderView(false);
      UI.toast('Пример удалён — можно заполнять своё расписание');
    },
  };

  Object.assign(App.actions, {
    'notif-test': () => {
      const c = App.Schedule.classesOn(new Date())[0] || Store.state.classes[0];
      const s = c && Store.subject(c.subjectId);
      App.Notify.push({
        kind: 'class',
        title: `Через 15 мин — ${s ? s.name : 'Математический анализ'}`,
        body: c ? App.Schedule.metaLine(c, false) + ` · ${c.start}–${c.end}` : 'Лекция · ауд. 305 · 08:30–10:00',
        route: 'schedule',
      });
    },
    'data-export': () => Settings.exportData(),
    'data-import': () => Settings.importData(),
    'data-reset': () => Settings.resetAll(),
    'sample-clear': () => Settings.clearSample(),
    'sample-hide': () => {
      Store.state.sampleBanner = false;
      Store.save();
      const b = U.$('#home-banner .banner');
      if (b) {
        b.style.transition = 'opacity .25s ease, transform .25s ease';
        b.style.opacity = '0';
        b.style.transform = 'translateY(-6px)';
        setTimeout(() => App.refresh(), 250);
      } else {
        App.refresh();
      }
    },
  });

  Object.assign(App.changes, {
    'week-names': (el, e) => {
      Store.state.settings.weekNames = e.target.value;
      Store.save();
      setTimeout(() => App.renderView(false), 200);
    },
    theme: (el, e) => {
      Store.state.settings.theme = e.target.value;
      Store.save();
      App.applyTheme();
    },
  });

  App.Settings = Settings;
})(window.App);
