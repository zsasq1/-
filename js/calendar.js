/* Семестр — выгрузка расписания и дедлайнов в календарь телефона (файл .ics) */
(function (App) {
  'use strict';

  const { U, Store, UI } = App;
  const { esc, ico } = U;

  // Киров живёт по UTC+3 круглый год: время пар переводим в UTC,
  // чтобы календарь показал его верно при любом часовом поясе телефона
  const TZ = 'Europe/Kirov';
  const TZ_OFFSET = 180;

  const LEADS = { 0: 'Без напоминания', 5: 'За 5 минут', 10: 'За 10 минут', 15: 'За 15 минут', 30: 'За 30 минут', 60: 'За час' };
  const KIND_WORD = { lecture: 'лекция', practice: 'практика', lab: 'лабораторная', seminar: 'семинар' };

  const utcOf = (iso, hm) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, U.toMin(hm) - TZ_OFFSET));
  };
  const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20260928T050000Z

  // Экранирование текста по RFC 5545
  const text = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // Строки длиннее 75 байт переносятся, не разрывая буквы: кириллица занимает 2 байта
  function fold(line) {
    let out = '';
    let bytes = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes + n > 75) { out += '\r\n '; bytes = 1; }
      out += ch;
      bytes += n;
    }
    return out;
  }

  // Короткий устойчивый хэш: одно и то же занятие получает тот же UID при повторной выгрузке
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  const Cal = {
    LEADS,

    defaultLead() {
      const lead = Number(Store.state.settings.classLead);
      return LEADS[lead] != null ? lead : 15;
    },

    /* ---------- События ---------- */

    classEvent(c, date, lead = 0) {
      const iso = U.ymd(date);
      const s = Store.subject(c.subjectId);
      const name = s ? s.name : 'Занятие';
      const t = App.Topics.lookup(c, iso);
      const lines = [];
      if (t && t.label) lines.push(`Тема: ${t.continued && !t.custom ? 'продолжение — ' : ''}${t.label}`);
      if (t && t.n > 0) lines.push(`${t.kind === 'lecture' ? 'Лекция' : 'Занятие'} ${t.n} из ${t.total}`);
      if (c.teacher) lines.push(`Преподаватель: ${c.teacher}`);
      if (t && t.note) lines.push(`Заметка: ${t.note}`);
      return {
        uid: `${iso.replace(/-/g, '')}T${c.start.replace(':', '')}-${hash(`${name}|${c.type}`)}@semestr`,
        start: utcOf(iso, c.start),
        end: utcOf(iso, c.end),
        title: `${name} · ${t && t.final ? 'итоговое' : KIND_WORD[c.type] || 'занятие'}`,
        location: [App.Schedule.roomText(c), c.place].filter(Boolean).join(', '),
        description: lines.join('\n'),
        category: Store.CLASS_TYPES_FULL[c.type] || '',
        alarm: lead > 0 ? lead : null,
      };
    },

    remEvent(r) {
      const due = new Date(r.due);
      let start = due;
      let end = new Date(due.getTime() + 30 * 6e4);
      // Дедлайн в 23:50 не должен переезжать на следующий день
      if (U.ymd(end) !== U.ymd(due)) { start = new Date(due.getTime() - 30 * 6e4); end = due; }
      const s = Store.subject(r.subjectId);
      const lead = Number(r.lead) || 0;
      return {
        uid: `rem-${r.id}@semestr`,
        start, end,
        title: r.kind === 'deadline' ? `Дедлайн: ${r.title}` : r.title,
        location: '',
        description: [s && `Предмет: ${s.name}`, r.kind === 'deadline' && `Срок: ${U.fmtDate(due)}, ${U.hm(due)}`].filter(Boolean).join('\n'),
        category: r.kind === 'deadline' ? 'Дедлайн' : 'Напоминание',
        alarmAt: new Date(due.getTime() - lead * 6e4),
      };
    },

    // Начало выгрузки: весь семестр или с сегодняшнего дня
    fromDate(period) {
      const { start } = App.Topics.semester();
      const today = U.startOfDay(new Date());
      return period === 'all' || today < start ? start : today;
    },

    classEvents(period, lead) {
      const { end } = App.Topics.semester();
      const out = [];
      for (let d = this.fromDate(period); d <= end; d = U.addDays(d, 1)) {
        App.Schedule.classesOn(d).forEach((c) => out.push(this.classEvent(c, d, lead)));
      }
      return out;
    },

    remEvents(period) {
      const from = this.fromDate(period);
      return Store.state.reminders
        .filter((r) => !r.done && r.due && new Date(r.due) >= from)
        .sort((a, b) => new Date(a.due) - new Date(b.due))
        .map((r) => this.remEvent(r));
    },

    /* ---------- Файл .ics ---------- */

    ics(events, calName) {
      const now = stamp(new Date());
      const L = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semestr//Study dashboard//RU',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${text(calName)}`, `X-WR-TIMEZONE:${TZ}`,
      ];
      events.forEach((e) => {
        L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${text(e.title)}`);
        if (e.location) L.push(`LOCATION:${text(e.location)}`);
        if (e.description) L.push(`DESCRIPTION:${text(e.description)}`);
        if (e.category) L.push(`CATEGORIES:${text(e.category)}`);
        if (e.alarm != null || e.alarmAt) {
          L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`,
            e.alarmAt ? `TRIGGER;VALUE=DATE-TIME:${stamp(e.alarmAt)}` : `TRIGGER:-PT${e.alarm}M`, 'END:VALARM');
        }
        L.push('END:VEVENT');
      });
      L.push('END:VCALENDAR');
      return `${L.map(fold).join('\r\n')}\r\n`;
    },

    calName() {
      const g = Store.state.profile.group;
      return g ? `Учёба · группа ${g}` : 'Учёба';
    },

    async save(events, filename) {
      const res = await U.saveFile(this.ics(events, this.calName()), filename, 'text/calendar;charset=utf-8');
      if (res === 'blocked') UI.toast('В предпросмотре файл календаря сохранить нельзя — откройте Семестр на сайте или из установленного приложения', { timeout: 7000 });
      return res === 'saved';
    },

    // Ссылка, которая открывает Google Календарь с уже заполненным событием
    googleUrl(e) {
      const p = new URLSearchParams({
        action: 'TEMPLATE',
        text: e.title,
        dates: `${stamp(e.start)}/${stamp(e.end)}`,
        details: e.description || '',
        location: e.location || '',
      });
      return `https://calendar.google.com/calendar/render?${p}`;
    },

    /* ---------- Окно выгрузки ---------- */

    openExport() {
      const st = Store.state;
      const sem = App.Topics.semester();
      const today = U.startOfDay(new Date());
      const opts = { period: today > sem.start && today <= sem.end ? 'rest' : 'all', lead: this.defaultLead() };
      const preview = U.inPreview();

      UI.modal({
        title: 'Добавить в календарь',
        focus: 'none',
        body: `
          <div class="cal">
            <p class="modal-text">Пары с темами занятий и дедлайны появятся в календаре телефона, и он сам напомнит о них — даже когда Семестр закрыт.</p>
            ${preview ? `<div class="banner cal-note">${ico('info')}<div class="banner-text">В предпросмотре файл календаря сохранить нельзя. Откройте Семестр на сайте или из установленного приложения.</div></div>` : ''}
            <div class="kg-list cal-list">
              <label class="kg-row" for="cal-cls"><input type="checkbox" id="cal-cls" checked>
                <span class="kg-text"><span class="kg-name">Занятия</span><span class="kg-meta" id="cal-cls-n"></span></span></label>
              <label class="kg-row" for="cal-rem"><input type="checkbox" id="cal-rem" checked>
                <span class="kg-text"><span class="kg-name">Дедлайны и напоминания</span><span class="kg-meta" id="cal-rem-n"></span></span></label>
            </div>
            <div class="form-grid">
              <div class="field span-2">
                <span class="field-label">Период</span>
                ${UI.seg('cal-period', 'cal-period', { rest: 'С сегодняшнего дня', all: 'Весь семестр' }, opts.period, 'full')}
              </div>
              <div class="field span-2">
                <label for="cal-lead">Напоминание перед парой</label>
                <select id="cal-lead" class="input">${Object.entries(LEADS).map(([v, l]) => `<option value="${v}" ${Number(v) === opts.lead ? 'selected' : ''}>${l}</option>`).join('')}</select>
              </div>
            </div>
            <details class="more">
              <summary>Как добавить на телефоне</summary>
              <div class="more-body">
                <ol class="howto">
                  <li><b>iPhone:</b> нажмите «Скачать» в Safari, откройте загрузку (стрелка ↓ в адресной строке) и выберите «Добавить все».</li>
                  <li><b>Android:</b> откройте скачанный файл из уведомления или папки «Загрузки» — телефон предложит календарь.</li>
                  <li><b>Google Календарь:</b> если телефон календарь не предлагает, откройте calendar.google.com на компьютере → Настройки → «Импорт и экспорт» и выберите файл. События сами появятся на телефоне.</li>
                </ol>
                <p class="field-hint">Удобнее завести для учёбы отдельный календарь: если расписание поменяется, его можно очистить и добавить файл заново.</p>
              </div>
            </details>
          </div>`,
        foot: `
          <button class="btn btn-ghost" type="button" data-close>Отмена</button>
          <button class="btn btn-primary" type="button" data-save ${preview ? 'disabled' : ''}>${ico('download')} <span data-save-text>Скачать</span></button>`,
        onMount: (el, api) => {
          const clsBox = el.querySelector('#cal-cls');
          const remBox = el.querySelector('#cal-rem');
          const btn = el.querySelector('[data-save]');
          let cls = [];
          let rem = [];

          const update = () => {
            cls = this.classEvents(opts.period, opts.lead);
            rem = this.remEvents(opts.period);
            el.querySelector('#cal-cls-n').textContent = cls.length
              ? `${U.count(cls.length, ['занятие', 'занятия', 'занятий'])} ${opts.period === 'all' ? 'за семестр' : 'до конца семестра'}, с темами и аудиториями`
              : 'В этот период занятий нет';
            el.querySelector('#cal-rem-n').textContent = rem.length
              ? `${U.count(rem.length, ['дело', 'дела', 'дел'])} со сроком`
              : 'Нет дел со сроком';
            const n = (clsBox.checked ? cls.length : 0) + (remBox.checked ? rem.length : 0);
            el.querySelector('[data-save-text]').textContent = n ? `Скачать · ${U.count(n, ['событие', 'события', 'событий'])}` : 'Нечего добавлять';
            if (!preview) btn.disabled = !n;
          };

          el.addEventListener('change', (e) => {
            if (e.target.name === 'cal-period') opts.period = e.target.value;
            if (e.target.id === 'cal-lead') opts.lead = Number(e.target.value);
            update();
          });
          btn.addEventListener('click', async () => {
            const events = [...(clsBox.checked ? cls : []), ...(remBox.checked ? rem : [])];
            if (!events.length) return;
            const ok = await this.save(events, `semestr-${st.profile.group || 'raspisanie'}-${U.ymd(new Date())}.ics`);
            if (!ok) return;
            st.settings.calExportedAt = new Date().toISOString();
            Store.save();
            api.close();
            if (App.route === 'settings') App.renderView(false);
            UI.toast(`Файл календаря сохранён: ${U.count(events.length, ['событие', 'события', 'событий'])}. Откройте его, чтобы добавить в календарь`, { timeout: 6000 });
          });
          update();
        },
      });
    },

    // Меню у отдельного занятия: Google Календарь или файл с одним событием
    menu(anchor, classId, iso) {
      const c = Store.state.classes.find((x) => x.id === classId);
      if (!c) return;
      const e = this.classEvent(c, U.parseYmd(iso), this.defaultLead());
      UI.popover(anchor, `
        <a class="menu-item" role="menuitem" href="${esc(this.googleUrl(e))}" target="_blank" rel="noopener" data-google>${ico('external')}<span>Google Календарь<span class="menu-sub">Откроется с заполненным занятием</span></span></a>
        ${U.inPreview() ? '' : `<button class="menu-item" role="menuitem" data-action="cal-one" data-id="${esc(classId)}" data-date="${esc(iso)}">${ico('download')}<span>Файл для календаря<span class="menu-sub">iPhone, Android, Outlook</span></span></button>`}
        <button class="menu-item" role="menuitem" data-action="cal-export">${ico('calendar')}<span>Всё расписание<span class="menu-sub">Все занятия семестра одним файлом</span></span></button>`,
      {
        role: 'menu',
        onMount: (pop) => pop.querySelector('[data-google]').addEventListener('click', () => setTimeout(() => UI.closePopover(), 0)),
      });
    },

    async saveOne(classId, iso) {
      const c = Store.state.classes.find((x) => x.id === classId);
      if (!c) return;
      const e = this.classEvent(c, U.parseYmd(iso), this.defaultLead());
      if (await this.save([e], `zanyatie-${iso}-${c.start.replace(':', '')}.ics`)) {
        UI.toast('Файл сохранён — откройте его, чтобы добавить занятие в календарь');
      }
    },
  };

  Object.assign(App.actions, {
    'cal-export': () => Cal.openExport(),
    'cal-menu': (el) => Cal.menu(el, el.dataset.id, el.dataset.date),
    'cal-one': (el) => Cal.saveOne(el.dataset.id, el.dataset.date),
  });

  App.Calendar = Cal;
})(window.App);
