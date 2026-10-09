/* Семестр — уведомления: лента, напоминания и дедлайны, системные оповещения */
(function (App) {
  'use strict';

  const { U, Store, UI } = App;
  const { esc, ico } = U;

  const LEADS = { 0: 'В момент срока', 15: 'За 15 минут', 60: 'За час', 180: 'За 3 часа', 1440: 'За день' };
  const DEADLINE_RE = /(сдать|сдача|дедлайн|экзамен|зач[её]т|коллоквиум|колло\b|контрольн|курсов|защит|отч[её]т|эссе|реферат|доклад|отработ|итогов|тест|модул|истори[яюи] болезни|курац|допуск|рецептур)/i;

  let lastUnread = -1;

  const Notify = {
    tab: 'feed',
    remFilter: 'active',
    LEADS,

    unread() {
      return Store.state.notifications.filter((n) => !n.read).length;
    },

    /* ---------- Создание уведомлений ---------- */

    push(n, opts = {}) {
      const item = Object.assign({ id: U.uid(), at: new Date().toISOString(), read: !!opts.read }, n);
      const list = Store.state.notifications;
      list.unshift(item);
      if (list.length > 150) list.length = 150;
      Store.save();
      if (opts.toast !== false) UI.notifyToast(item, () => this.openItem(item.id));
      if (!opts.silent) {
        this.system(item);
        this.ring();
      }
      App.refresh();
      return item;
    },

    async system(n) {
      if (!Store.state.settings.systemNotify) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const shown = App.PWA && await App.PWA.notify(n.title, { body: n.body || '', tag: n.id, data: { id: n.id, route: n.route } });
      if (shown) return;
      try {
        const x = new Notification(n.title, { body: n.body || '', tag: n.id, icon: App.iconUrl });
        x.onclick = () => { window.focus(); this.openItem(n.id); x.close(); };
      } catch (e) {
        // На некоторых мобильных браузерах уведомления доступны только через service worker
      }
    },

    ring() {
      const bell = U.$('#bell-btn');
      if (!bell) return;
      bell.classList.remove('is-ringing');
      void bell.offsetWidth;
      bell.classList.add('is-ringing');
      setTimeout(() => bell.classList.remove('is-ringing'), 1100);
    },

    async enableSystem() {
      const st = Store.state.settings;
      if (!('Notification' in window)) {
        UI.toast('Этот браузер не поддерживает системные уведомления');
        return false;
      }
      let p = Notification.permission;
      if (p === 'default') {
        try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; }
      }
      st.systemNotify = p === 'granted';
      Store.save();
      App.refresh();
      UI.toast(p === 'granted'
        ? 'Системные уведомления включены'
        : 'Браузер запретил уведомления. Разрешите их в настройках сайта и попробуйте снова');
      return p === 'granted';
    },

    permissionText() {
      if (!('Notification' in window)) return 'Браузер не поддерживает системные уведомления';
      if (Notification.permission === 'denied') return 'Запрещены в настройках браузера';
      if (Notification.permission === 'granted' && Store.state.settings.systemNotify) return 'Включены';
      return 'Выключены';
    },

    /* ---------- Планировщик ---------- */

    tick() {
      const st = Store.state;
      const now = new Date();
      const lead = Number(st.settings.classLead) || 0;

      if (lead > 0) {
        App.Schedule.classesOn(now).forEach((c) => {
          const diff = U.atTime(now, c.start) - now;
          const key = `c:${c.id}:${U.ymd(now)}`;
          if (diff > 0 && diff <= lead * 6e4 && !st.fired[key]) {
            st.fired[key] = Date.now();
            const s = Store.subject(c.subjectId);
            this.push({
              kind: 'class',
              title: `Через ${U.relIn(diff)} — ${s ? s.name : 'занятие'}`,
              body: [Store.CLASS_TYPES_FULL[c.type], App.Schedule.roomText(c) || App.Schedule.placeShort(c), `${c.start}–${c.end}`].filter(Boolean).join(' · ')
                + ((App.Topics && App.Topics.line(c, now)) ? `. Тема: ${App.Topics.line(c, now).text}` : ''),
              route: 'schedule',
            });
          }
        });
      }

      st.reminders.forEach((r) => {
        if (r.done || !r.due) return;
        const due = new Date(r.due);
        const at = due.getTime() - (Number(r.lead) || 0) * 6e4;
        const key = `r:${r.id}:${r.due}:${r.lead}`;
        if (now >= at && now - at < 6 * 36e5 && !st.fired[key]) {
          st.fired[key] = Date.now();
          const left = due - now;
          const s = Store.subject(r.subjectId);
          const when = left > 6e4 ? `Срок ${U.fmtWhen(due, now)}, осталось ${U.relIn(left)}` : 'Срок наступил';
          this.push({
            kind: r.kind === 'deadline' ? 'deadline' : 'reminder',
            title: r.title,
            body: s ? `${when} · ${s.name}` : when,
            route: 'reminders',
          });
        }
      });

      // Итоговые: за три дня и накануне — с тем, что повторить
      if (App.Topics) {
        App.Topics.finals().forEach((f) => {
          const left = f.at - now;
          const stage = f.passed || left <= 0 ? 0 : left <= 864e5 ? 1 : left <= 3 * 864e5 ? 3 : 0;
          const key = `f:${f.id}:${stage}`;
          if (!stage || st.fired[key]) return;
          st.fired[key] = Date.now();
          this.push({
            kind: 'deadline',
            title: `Итоговое ${U.fmtWhen(f.at, now)} — ${f.subject}`,
            body: f.know.length ? `Повторить ${U.count(f.know.length, ['тему', 'темы', 'тем'])} — список в дедлайнах` : f.title,
            route: 'reminders',
          });
        });
      }

      // Чистим старые отметки, чтобы не копились
      const weekAgo = Date.now() - 14 * 864e5;
      Object.keys(st.fired).forEach((k) => { if (st.fired[k] < weekAgo) delete st.fired[k]; });
    },

    /* ---------- Счётчики ---------- */

    updateBadges() {
      const n = this.unread();
      const dot = U.$('.bell-dot');
      if (dot) dot.hidden = n === 0;
      const bell = U.$('#bell-btn');
      if (bell) bell.setAttribute('aria-label', n ? `Уведомления: ${n} непрочитанных` : 'Уведомления');
      document.title = n ? `(${n}) Семестр` : 'Семестр';
      const badge = U.$('#nav-badge');
      if (badge && n > lastUnread && lastUnread >= 0) badge.classList.add('is-pop');
      lastUnread = n;
    },

    openItem(id) {
      const n = Store.state.notifications.find((x) => x.id === id);
      if (!n) return;
      n.read = true;
      Store.save();
      UI.closePopover();
      if (n.route === 'reminders') {
        this.tab = 'reminders';
        App.go('notifications');
      } else if (n.route && n.route !== App.route) {
        App.go(n.route);
      } else {
        App.refresh();
      }
    },

    readAll() {
      Store.state.notifications.forEach((n) => { n.read = true; });
      Store.save();
      App.refresh();
    },

    /* ---------- Разметка ---------- */

    notifItem(n) {
      return `
        <button class="notif ${n.read ? '' : 'is-unread'}" data-action="notif-open" data-id="${n.id}">
          <span class="notif-ico k-${esc(n.kind)}">${UI.kindIcon(n.kind)}</span>
          <span class="notif-main">
            <span class="notif-title">${esc(n.title)}</span>
            ${n.body ? `<span class="notif-body">${esc(n.body)}</span>` : ''}
            <span class="notif-time">${U.timeAgo(new Date(n.at))}</span>
          </span>
        </button>`;
    },

    remItem(r, now = new Date()) {
      const s = Store.subject(r.subjectId);
      const due = r.due ? new Date(r.due) : null;
      let dueCls = '';
      let dueText = 'Без срока';
      if (due) {
        dueText = U.cap(U.fmtWhen(due, now));
        if (!r.done && due < now) { dueCls = 'is-over'; dueText = `Просрочено · ${U.fmtWhen(due, now)}`; }
        else if (!r.done && due - now < 864e5) dueCls = 'is-soon';
      }
      return `
        <li class="rem ${r.done ? 'is-done' : ''}" data-rem="${r.id}">
          <button class="check" data-action="rem-toggle" data-id="${r.id}" role="checkbox" aria-checked="${r.done ? 'true' : 'false'}" aria-label="${r.done ? 'Вернуть в работу' : 'Отметить выполненным'}">${ico('check')}</button>
          <div class="rem-main" data-action="rem-edit" data-id="${r.id}" role="button" tabindex="0">
            <span class="rem-title">${esc(r.title)}</span>
            <div class="rem-meta">
              ${r.kind === 'deadline' ? `<span class="kind-deadline">${ico('flag')}Дедлайн</span>` : ''}
              <span class="due ${dueCls}">${ico('clock')}${esc(dueText)}</span>
              ${s ? `<span class="tag" style="--h:${s.hue}">${esc(s.name)}</span>` : ''}
            </div>
          </div>
        </li>`;
    },

    // Итоговое занятие в списке дел: предмет, когда и что повторить
    finalItem(f, now = new Date(), short = false) {
      const s = Store.subject(f.subjectId);
      let dueCls = '';
      if (!f.passed && f.at > now && f.at - now < 3 * 864e5) dueCls = 'is-soon';
      const left = f.at > now && !f.passed ? ` · через ${U.relIn(f.at - now)}` : '';
      const know = short ? f.know.slice(0, 3) : f.know;
      return `
        <li class="rem is-final ${f.passed ? 'is-done' : ''}" style="--h:${s ? s.hue : 40}">
          <button class="check" data-action="final-toggle" data-key="${esc(f.id)}" role="checkbox" aria-checked="${f.passed ? 'true' : 'false'}" aria-label="${f.passed ? 'Вернуть в работу' : 'Отметить сданным'}">${ico('check')}</button>
          <div class="rem-main" data-action="occ-open" data-id="${esc(f.classId)}" data-date="${f.date}" role="button" tabindex="0">
            <span class="rem-title">${esc(f.subject)}</span>
            <span class="rem-sub">${esc(f.title)}</span>
            <div class="rem-meta">
              <span class="kind-final">${ico('flag')}Итоговое</span>
              <span class="due ${dueCls}">${ico('clock')}${esc(U.cap(U.fmtWhen(f.at, now)))}${left}</span>
              ${f.where ? `<span>${ico('pin')}${esc(f.where)}</span>` : ''}
            </div>
            ${f.know.length ? `
            <div class="rem-know">
              <span class="rem-know-head">Что надо знать · ${U.count(f.know.length, ['тема', 'темы', 'тем'])}</span>
              <ol>${know.map((k) => `<li>${esc(k.t)}</li>`).join('')}</ol>
              ${know.length < f.know.length ? `<span class="rem-know-more">и ещё ${U.count(f.know.length - know.length, ['тема', 'темы', 'тем'])} — нажмите, чтобы открыть</span>` : ''}
            </div>` : f.about ? `<p class="rem-about">${esc(f.about)}</p>` : ''}
          </div>
        </li>`;
    },

    // Дела, дедлайны и итоговые занятия одним списком по сроку
    agenda(done, now = new Date()) {
      const rems = this.sortedReminders(done).map((r) => ({ r, t: r.due ? new Date(r.due).getTime() : Infinity }));
      const fin = (App.Topics ? App.Topics.finals() : [])
        .filter((f) => (done ? f.passed : !f.passed && f.endAt > now))
        .map((f) => ({ f, t: f.at.getTime() }));
      if (done) return rems.concat(fin);
      return rems.concat(fin).sort((a, b) => a.t - b.t);
    },

    agendaItem(x, now, short) {
      return x.f ? this.finalItem(x.f, now, short) : this.remItem(x.r, now);
    },

    sortedReminders(done) {
      return Store.state.reminders
        .filter((r) => !!r.done === done)
        .sort((a, b) => {
          if (done) return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
          if (!a.due && !b.due) return String(a.createdAt).localeCompare(String(b.createdAt));
          if (!a.due) return 1;
          if (!b.due) return -1;
          return new Date(a.due) - new Date(b.due);
        });
    },

    /* ---------- Экран ---------- */

    render() {
      const unread = this.unread();
      const isFeed = this.tab === 'feed';
      const active = this.agenda(false).length;
      return `
        <div class="page-head rise" style="--i:0">
          <div>
            <h1 class="page-title">Уведомления</h1>
            <p class="page-sub">${isFeed
              ? (unread ? U.count(unread, ['непрочитанное', 'непрочитанных', 'непрочитанных']) : 'Всё прочитано')
              : (active ? `${U.count(active, ['активное дело', 'активных дела', 'активных дел'])}` : 'Все дела сделаны')}</p>
          </div>
          <div class="head-actions">
            ${isFeed
              ? `<button class="btn" data-action="notif-read-all" ${unread ? '' : 'disabled'}>${ico('check-all')} Прочитать все</button>`
              : `<button class="btn btn-primary" data-action="rem-new">${ico('plus')} Напоминание</button>`}
          </div>
        </div>
        <div class="tabs-row rise" style="--i:2">
          ${UI.seg('nt', 'ntab', { feed: 'Лента', reminders: 'Напоминания и дедлайны' }, this.tab)}
          ${isFeed ? '' : UI.seg('rf', 'rfilter', { active: 'Активные', done: 'Выполненные' }, this.remFilter)}
        </div>
        <div id="notif-body" class="rise" style="--i:3">${isFeed ? this.renderFeed() : this.renderReminders()}</div>`;
    },

    renderFeed() {
      const list = Store.state.notifications;
      if (!list.length) {
        return `<div class="empty"><div class="empty-title">Лента пуста</div><p>Здесь появятся напоминания о парах, дедлайнах и новых файлах.</p></div>`;
      }
      const now = new Date();
      const groups = { 'Сегодня': [], 'Вчера': [], 'Раньше': [] };
      list.forEach((n) => {
        const d = U.dayDiff(new Date(n.at), now);
        groups[d <= 0 ? 'Сегодня' : d === 1 ? 'Вчера' : 'Раньше'].push(n);
      });
      return `<div class="feed">${Object.entries(groups).filter(([, l]) => l.length).map(([title, l]) => `
        <section class="feed-group">
          <h3>${title}</h3>
          <div class="feed-list">${l.map((n) => this.notifItem(n)).join('')}</div>
        </section>`).join('')}
        <div><button class="btn btn-ghost btn-sm" data-action="notif-clear">${ico('trash')} Очистить ленту</button></div>
      </div>`;
    },

    renderReminders() {
      const done = this.remFilter === 'done';
      const now = new Date();
      const list = this.agenda(done, now);
      if (!list.length) {
        return done
          ? `<div class="empty"><div class="empty-title">Пока ничего не выполнено</div><p>Отмеченные дела будут собираться здесь.</p></div>`
          : `<div class="empty"><div class="empty-title">Все дела сделаны</div><p>Добавьте дедлайн или напоминание — мы напомним вовремя.</p>
              <button class="btn btn-primary" data-action="rem-new">${ico('plus')} Напоминание</button></div>`;
      }
      return `<div class="rem-card"><ul class="rem-list">${list.map((x) => this.agendaItem(x, now)).join('')}</ul></div>`;
    },

    /* ---------- Поповер колокольчика ---------- */

    openBell(anchor) {
      const list = Store.state.notifications.slice(0, 6);
      UI.popover(anchor, `
        <div class="np-head"><b>Уведомления</b>
          ${this.unread() ? `<button class="btn btn-ghost btn-sm" data-action="notif-read-all">Прочитать все</button>` : ''}
        </div>
        <div class="np-list">${list.length ? list.map((n) => this.notifItem(n)).join('') : '<div class="empty"><p>Новых уведомлений нет</p></div>'}</div>
        <a class="np-foot" href="#notifications" data-action="go" data-route="notifications">Все уведомления</a>`,
      { className: 'np' });
    },

    /* ---------- Напоминания ---------- */

    toggle(id, btn) {
      const r = Store.state.reminders.find((x) => x.id === id);
      if (!r) return;
      r.done = !r.done;
      r.doneAt = r.done ? new Date().toISOString() : null;
      delete r.sample;
      Store.save();
      const li = btn && btn.closest('.rem');
      if (li) {
        li.classList.toggle('is-done', r.done);
        btn.setAttribute('aria-checked', String(r.done));
        // Даём дорисоваться галочке и зачёркиванию, затем убираем строку из списка
        setTimeout(() => {
          li.classList.add('is-leaving');
          setTimeout(() => App.refresh(), 380);
        }, 650);
      } else {
        App.refresh();
      }
      if (r.done) {
        UI.toast('Отмечено выполненным', {
          action: { label: 'Отменить', fn: () => { r.done = false; r.doneAt = null; Store.save(); App.refresh(); } },
        });
      }
    },

    remove(id) {
      const st = Store.state;
      const i = st.reminders.findIndex((r) => r.id === id);
      if (i < 0) return;
      const [removed] = st.reminders.splice(i, 1);
      const subjects = st.subjects.slice();
      Store.gcSubjects();
      Store.save();
      App.refresh();
      UI.toast('Напоминание удалено', {
        action: {
          label: 'Вернуть',
          fn: () => { st.subjects = subjects; st.reminders.splice(i, 0, removed); Store.save(); App.refresh(); },
        },
      });
    },

    guessKind(title) {
      return DEADLINE_RE.test(title) ? 'deadline' : 'reminder';
    },

    defaultLead(kind, due, now = new Date()) {
      if (!due) return 0;
      if (kind !== 'deadline') return 0;
      return due - now > 2 * 864e5 ? 1440 : 60;
    },

    openModal(rem, preset = {}) {
      const isEdit = !!rem;
      const r = rem || {
        title: preset.title || '', kind: preset.kind || 'reminder', subjectId: preset.subjectId || null,
        due: preset.due || null, lead: preset.kind === 'deadline' ? 1440 : 0,
      };
      const subj = Store.subject(r.subjectId);
      const subjects = Store.sortedSubjects();
      const dueVal = r.due ? U.toLocalInput(new Date(r.due)) : '';

      UI.modal({
        title: isEdit ? (r.kind === 'deadline' ? 'Дедлайн' : 'Напоминание') : (r.kind === 'deadline' ? 'Новый дедлайн' : 'Новое напоминание'),
        body: `
          <form id="rf" class="form-grid" autocomplete="off" novalidate>
            <div class="field span-2">
              <label for="rf-title">Что сделать</label>
              <input id="rf-title" class="input" value="${esc(r.title)}" placeholder="Например, отработка по фармакологии" required ${isEdit ? '' : 'autofocus'}>
            </div>
            <div class="field span-2">
              <span class="field-label">Тип</span>
              ${UI.seg('rf-kind', 'kind', { reminder: 'Напоминание', deadline: 'Дедлайн' }, r.kind, 'full')}
            </div>
            <div class="field span-2">
              <label for="rf-subj">Предмет</label>
              <input id="rf-subj" class="input" list="rf-subj-list" value="${esc(subj ? subj.name : '')}" placeholder="Необязательно">
              <datalist id="rf-subj-list">${subjects.map((s) => `<option value="${esc(s.name)}"></option>`).join('')}</datalist>
            </div>
            <div class="field">
              <label for="rf-due">Срок</label>
              <input id="rf-due" type="datetime-local" class="input" value="${dueVal}">
            </div>
            <div class="field">
              <label for="rf-lead">Напомнить</label>
              <select id="rf-lead" class="input">${Object.entries(LEADS).map(([v, l]) => `<option value="${v}" ${Number(v) === Number(r.lead) ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>
            <p class="field-hint span-2">Без срока напоминание просто останется в списке дел.</p>
            <p class="form-error span-2" id="rf-err" hidden></p>
          </form>`,
        foot: `
          ${isEdit ? `<button class="btn btn-ghost btn-danger" type="button" data-del>${ico('trash')} Удалить</button><span class="spacer"></span>` : ''}
          <button class="btn btn-ghost" type="button" data-close>Отмена</button>
          <button class="btn btn-primary" type="submit" form="rf">${isEdit ? 'Сохранить' : 'Добавить'}</button>`,
        onMount: (el, api) => {
          const title = el.querySelector('#rf-title');
          const err = el.querySelector('#rf-err');
          setTimeout(() => title.setSelectionRange(title.value.length, title.value.length), 90);
          if (isEdit) {
            el.querySelector('[data-del]').addEventListener('click', () => { api.close(); this.remove(rem.id); });
          }
          el.querySelector('#rf').addEventListener('submit', (e) => {
            e.preventDefault();
            const t = title.value.trim();
            if (!t) { err.textContent = 'Напишите, что нужно сделать.'; err.hidden = false; title.focus(); return; }
            const subjName = el.querySelector('#rf-subj').value.trim();
            const subject = subjName ? Store.subjectByName(subjName) : null;
            const due = U.fromLocalInput(el.querySelector('#rf-due').value);
            const data = {
              title: t,
              kind: (el.querySelector('input[name=kind]:checked') || {}).value || 'reminder',
              subjectId: subject ? subject.id : null,
              due: due ? due.toISOString() : null,
              lead: Number(el.querySelector('#rf-lead').value) || 0,
            };
            if (isEdit) {
              Object.assign(rem, data);
              delete rem.sample;
            } else {
              Store.state.reminders.push(Object.assign({
                id: U.uid(), done: false, doneAt: null, createdAt: new Date().toISOString(),
              }, data));
            }
            Store.gcSubjects();
            Store.save();
            api.close();
            App.refresh();
            UI.toast(isEdit ? 'Изменения сохранены' : (due ? `Добавлено · ${U.fmtWhen(due)}` : 'Добавлено в список дел'));
            this.tick();
          });
        },
      });
    },
  };

  Object.assign(App.actions, {
    bell: (el) => Notify.openBell(el),
    'notif-open': (el) => Notify.openItem(el.dataset.id),
    'notif-read-all': () => { Notify.readAll(); UI.closePopover(); },
    'notif-clear': async () => {
      const ok = await UI.confirm({ title: 'Очистить ленту?', text: 'Все уведомления будут удалены. Напоминания и дедлайны останутся.', ok: 'Очистить' });
      if (!ok) return;
      Store.state.notifications = [];
      Store.save();
      App.refresh();
    },
    'perm-enable': () => Notify.enableSystem(),
    'rem-new': (el) => Notify.openModal(null, { kind: el.dataset.kind, title: el.dataset.title }),
    'rem-edit': (el) => {
      const r = Store.state.reminders.find((x) => x.id === el.dataset.id);
      if (r) Notify.openModal(r);
    },
    'rem-toggle': (el) => Notify.toggle(el.dataset.id, el),
  });

  Object.assign(App.changes, {
    ntab: (el, e) => { Notify.tab = e.target.value; setTimeout(() => App.renderView(false), 180); },
    rfilter: (el, e) => { Notify.remFilter = e.target.value; setTimeout(() => App.renderView(false), 180); },
  });

  App.Notify = Notify;
})(window.App);
