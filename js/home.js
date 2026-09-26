/* Семестр — главная: приветствие, быстрый ввод, сегодняшние пары, дела и файлы */
(function (App) {
  'use strict';

  const { U, Store, UI } = App;
  const { esc, ico } = U;

  // Тема занятия и заметка под названием в карточке «Сегодня»
  function topicLine(c, date) {
    const t = App.Topics ? App.Topics.line(c, date) : null;
    if (!t) return '';
    return `<span class="tl-topic">${t.final ? '<span class="pill accent">итоговое</span>' : ''}<span>${esc(t.text)}</span></span>${t.note ? `<span class="tl-note">${ico('pencil')}${esc(t.note)}</span>` : ''}`;
  }

  const Home = {
    att: [],          // файлы, прикреплённые к полю ввода
    manualDue: null,  // срок, выбранный вручную
    noParse: false,   // пользователь убрал распознанный срок

    render() {
      const st = Store.state;
      const now = new Date();
      const p = App.Schedule.parity(now);
      const name = (st.profile.name || '').trim();
      const words = `${U.greeting(now)}${name ? `, ${name}` : ''}`.split(' ')
        .map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');

      return `
        <section class="hero">
          <h1 class="greet">${U.mark()}<span>${words}</span></h1>
          <p class="hero-meta rise" style="--i:3">${U.cap(U.fmtDayLong(now))} · ${esc(App.Schedule.weekLabel(p))}${App.Schedule.weekPill(p)}</p>
          ${this.composer()}
          <div class="suggest rise" style="--i:5">
            <button type="button" data-action="rem-new" data-kind="deadline" data-title="Отработка: ">${ico('flag')}Отработка</button>
            <button type="button" data-action="files-pick">${ico('upload')}Загрузить методичку</button>
            <button type="button" data-action="rem-new" data-kind="deadline">${ico('clock')}Коллоквиум или тест</button>
            <button type="button" data-action="go" data-route="schedule">${ico('grid')}Расписание недели</button>
          </div>
        </section>
        <div id="home-banner">${this.banner()}</div>
        <div class="home-grid ${this.banner() ? '' : 'no-banner'}" id="home-grid">
          <div class="col">
            <section class="card rise" style="--i:7" id="card-today">${this.todayCard(now)}</section>
          </div>
          <div class="col">
            <section class="card rise" style="--i:8" id="card-rem">${this.remCard(now)}</section>
            <section class="card rise" style="--i:9" id="card-files">${this.filesCard()}</section>
          </div>
        </div>`;
    },

    banner() {
      const onboard = App.KGMU ? App.KGMU.onboardCard() : '';
      if (onboard) return `<div class="sample-banner">${onboard}</div>`;
      const last = App.Schedule.semesterOver(new Date());
      if (last && App.KGMU) {
        return `
          <div class="banner sample-banner rise" style="--i:6">${ico('info')}
            <div class="banner-text"><b>Семестр по расписанию закончился ${U.fmtDate(last)}.</b> Когда на сайте КГМУ появится расписание следующего полугодия, скачайте .xlsx своего потока и загрузите его — темы 6 семестра уже есть.</div>
            <div class="banner-actions">
              <a class="btn btn-sm" href="${esc(App.KGMU_DATA.page)}" target="_blank" rel="noopener">Сайт КГМУ</a>
              <button class="btn btn-sm" data-action="kgmu-upload">${ico('upload')} Загрузить</button>
            </div>
          </div>`;
      }
      if (!Store.state.sampleBanner || !Store.hasSample()) return '';
      return `
        <div class="banner sample-banner rise" style="--i:6">${ico('info')}
          <div class="banner-text"><b>Дела и файлы ниже — пример.</b> Они показывают, как всё работает. Когда добавите свои, пример можно убрать одной кнопкой.</div>
          <div class="banner-actions">
            <button class="btn btn-sm" data-action="sample-clear">Очистить пример</button>
            <button class="icon-btn sm" data-action="sample-hide" aria-label="Скрыть подсказку">${ico('x')}</button>
          </div>
        </div>`;
    },

    composer() {
      return `
        <form class="composer rise" style="--i:4" id="composer" autocomplete="off">
          <div class="att-list" id="att-list" ${this.att.length ? '' : 'hidden'}>${this.attHtml()}</div>
          <label for="composer-input" class="sr-only">Новое напоминание</label>
          <textarea id="composer-input" rows="1" placeholder="Что не забыть? Например: отработка по патанатомии в пятницу в 15:45"></textarea>
          <div class="composer-bar">
            <button type="button" class="icon-btn" data-action="composer-attach" title="Прикрепить файлы" aria-label="Прикрепить файлы">${ico('paperclip')}</button>
            <label class="chip-select" title="Предмет">${ico('book')}<span class="sr-only">Предмет</span>
              <select id="composer-subj">${this.subjectOptions()}</select>
            </label>
            <button type="button" class="icon-btn" data-action="composer-date" id="composer-date-btn" title="Выбрать срок" aria-label="Выбрать срок">${ico('clock')}</button>
            <input type="datetime-local" id="composer-due" class="input input-sm" aria-label="Срок" hidden>
            <span id="date-chip-slot"></span>
            <button type="submit" class="send" id="composer-send" aria-label="Добавить" title="Добавить (Enter)" disabled>${ico('arrow-up')}</button>
          </div>
        </form>`;
    },

    subjectOptions(selected = '') {
      return `<option value="">Без предмета</option>${Store.sortedSubjects()
        .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    },

    attHtml() {
      return this.att.map((f, i) => `
        <div class="att">${App.Files.tile(f, 'sm')}
          <span class="att-info"><span class="att-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="att-size">${U.fmtSize(f.size)}</span></span>
          <button type="button" class="icon-btn sm" data-action="att-remove" data-i="${i}" aria-label="Убрать ${esc(f.name)}">${ico('x')}</button>
        </div>`).join('');
    },

    /* ---------- Карточки ---------- */

    todayCard(now) {
      const S = App.Schedule;
      const list = S.classesOn(now);
      const allPast = list.length && list.every((c) => S.status(c, now, now) === 'past');
      let firstLater = true;
      const items = list.map((c) => {
        const status = S.status(c, now, now);
        const subj = Store.subject(c.subjectId);
        let extra = '';
        if (status === 'now') {
          const s = U.atTime(now, c.start);
          const e = U.atTime(now, c.end);
          const pct = U.clamp(((now - s) / (e - s)) * 100, 0, 100);
          extra = `<div class="tl-status">Идёт · ещё ${U.relIn(e - now)}</div><div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>`;
        } else if (status === 'later' && firstLater) {
          firstLater = false;
          extra = `<div class="tl-status">Через ${U.relIn(U.atTime(now, c.start) - now)}</div>`;
        }
        return `
          <button class="tl-item is-${status} ${Store.subjClass(c.subjectId)}" style="${Store.subjStyle(c.subjectId)}" data-action="occ-open" data-id="${c.id}" data-date="${U.ymd(now)}">
            <span class="tl-time"><b>${c.start}</b>${c.end}</span>
            <span>
              <span class="tl-name"><span class="dot"></span><span>${esc(subj ? subj.name : 'Без названия')}</span></span>
              <span class="tl-meta">
                <span>${esc(Store.CLASS_TYPES_FULL[c.type] || '')}</span>
                ${c.room || c.place ? `<span title="${esc(c.place || '')}">${ico('pin')}${esc([App.Schedule.roomText(c), App.Schedule.placeShort(c)].filter(Boolean).join(' · '))}</span>` : ''}
                ${c.teacher ? `<span>${ico('user')}${esc(c.teacher)}</span>` : ''}
              </span>
              ${topicLine(c, now)}
              ${extra}
            </span>
          </button>`;
      }).join('');

      let next = '';
      if (!list.length || allPast) {
        const nd = S.nextDayWithClasses(U.addDays(now, 1));
        if (nd) {
          next = `
            <div class="next-day">
              <div class="next-day-label">${U.cap(U.dayWord(nd.date, now))}${U.dayDiff(now, nd.date) > 1 ? '' : `, ${U.fmtDate(nd.date)}`} · ${U.count(nd.list.length, ['занятие', 'занятия', 'занятий'])}</div>
              ${nd.list.map((c) => {
                const s = Store.subject(c.subjectId);
                const t = App.Topics ? App.Topics.line(c, nd.date) : null;
                return `<button class="next-day-row ${Store.subjClass(c.subjectId)}" style="${Store.subjStyle(c.subjectId)}" data-action="occ-open" data-id="${c.id}" data-date="${U.ymd(nd.date)}"><time>${c.start}</time><span class="dot"></span><span class="nd-text"><span>${esc(s ? s.name : '')}</span>${t ? `<span class="nd-topic">${esc(t.text)}</span>` : ''}</span></button>`;
              }).join('')}
            </div>`;
        }
      }

      const holiday = S.holiday(now);
      const over = S.semesterOver(now);
      const empty = !list.length
        ? `<div class="empty"><div class="empty-title">${holiday ? `Праздник: ${esc(holiday)}` : 'Сегодня занятий нет'}</div>${
          !Store.state.classes.length
            ? '<p>Выберите группу — и здесь появится план на день.</p><button class="btn btn-sm" data-action="kgmu-import">' + ico('calendar') + ' Выбрать группу</button>'
            : over ? '<p>Занятия по загруженному расписанию закончились.</p>'
              : holiday ? '<p>Занятий нет — выходной день.</p>' : '<p>Можно выдохнуть или заняться отработками.</p>'}</div>`
        : allPast ? `<p class="empty" style="padding:4px 16px 10px">На сегодня занятия закончились.</p>` : '';

      return `
        <div class="card-head">
          <h2 class="card-title">Сегодня${list.length ? `<span class="count">${U.count(list.length, ['занятие', 'занятия', 'занятий'])}</span>` : ''}</h2>
          <a class="card-link" href="#schedule" data-action="go" data-route="schedule">Вся неделя${ico('chevron-right')}</a>
        </div>
        ${list.length ? `<div class="tl">${items}</div>` : ''}
        ${empty}${next}`;
    },

    remCard(now) {
      const list = App.Notify.sortedReminders(false).slice(0, 5);
      const total = Store.state.reminders.filter((r) => !r.done).length;
      return `
        <div class="card-head">
          <h2 class="card-title">Дела и дедлайны${total ? `<span class="count">${total}</span>` : ''}</h2>
          <a class="card-link" href="#notifications" data-action="open-reminders">Все${ico('chevron-right')}</a>
        </div>
        ${list.length
          ? `<ul class="rem-list">${list.map((r) => App.Notify.remItem(r, now)).join('')}</ul>`
          : `<div class="empty"><div class="empty-title">Всё сделано</div><p>Напишите задачу в поле выше — срок распознается сам.</p></div>`}`;
    },

    filesCard() {
      const files = Store.state.files.slice(0, 4);
      return `
        <div class="card-head">
          <h2 class="card-title">Недавние файлы</h2>
          <a class="card-link" href="#files" data-action="go" data-route="files">Все файлы${ico('chevron-right')}</a>
        </div>
        ${files.length ? `<div class="mini-files">${files.map((f) => {
          const s = Store.subject(f.subjectId);
          return `
            <button class="mini-file" data-action="file-open" data-id="${f.id}">
              ${App.Files.tile(f, 'sm')}
              <span class="mini-file-info"><span class="mini-file-name">${esc(f.name)}</span>
              <span class="mini-file-meta">${s ? `${esc(s.name)} · ` : ''}${U.fmtSize(f.size)}</span></span>
            </button>`;
        }).join('')}</div>`
        : `<div class="empty"><p>Перетащите сюда конспекты или методички — они сохранятся в браузере.</p>
            <button class="btn btn-sm" data-action="files-pick">${ico('upload')} Загрузить</button></div>`}`;
    },

    /* ---------- Жизненный цикл ---------- */

    mount(view) {
      const form = U.$('#composer', view);
      const ta = U.$('#composer-input', view);
      const due = U.$('#composer-due', view);
      this.manualDue = null;
      this.noParse = false;

      const autosize = () => {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
      };
      ta.addEventListener('input', () => {
        if (!ta.value.trim()) this.noParse = false;
        autosize();
        this.updateChip();
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });
      due.addEventListener('change', () => {
        this.manualDue = U.fromLocalInput(due.value);
        due.hidden = true;
        this.updateChip();
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });

      form.addEventListener('dragover', () => form.classList.add('is-drop'));
      form.addEventListener('dragleave', () => form.classList.remove('is-drop'));
      form.addEventListener('drop', () => form.classList.remove('is-drop'));
      this.updateChip();
    },

    refresh(view) {
      const now = new Date();
      const set = (id, html) => { const el = U.$(`#${id}`, view); if (el) el.innerHTML = html; };
      set('card-today', this.todayCard(now));
      set('card-rem', this.remCard(now));
      set('card-files', this.filesCard());
      set('home-banner', this.banner());
      const grid = U.$('#home-grid', view);
      if (grid) grid.classList.toggle('no-banner', !this.banner());
      const sel = U.$('#composer-subj', view);
      if (sel) {
        const v = sel.value;
        sel.innerHTML = this.subjectOptions(v);
        if (!Store.subject(v)) sel.value = '';
      }
    },

    onMinute(view) {
      const el = U.$('#card-today', view);
      if (el) el.innerHTML = this.todayCard(new Date());
    },

    /* ---------- Поле ввода ---------- */

    currentDue() {
      if (this.manualDue) return { due: this.manualDue, clean: null };
      if (this.noParse) return null;
      const ta = U.$('#composer-input');
      return ta ? U.parseWhen(ta.value) : null;
    },

    updateChip() {
      const slot = U.$('#date-chip-slot');
      const send = U.$('#composer-send');
      const ta = U.$('#composer-input');
      if (!slot || !ta) return;
      const parsed = this.currentDue();
      const text = parsed ? U.cap(U.fmtWhen(parsed.due)) : '';
      if (slot.dataset.text !== text) {
        slot.dataset.text = text;
        slot.innerHTML = parsed
          ? `<span class="date-chip" title="${this.manualDue ? 'Срок выбран вручную' : 'Срок распознан из текста'}">${ico('clock')}${esc(text)}
              <button type="button" data-action="date-clear" aria-label="Убрать срок">${ico('x')}</button></span>`
          : '';
      }
      send.disabled = !ta.value.trim() && !this.att.length;
    },

    attach(list) {
      const files = Array.from(list || []);
      if (!files.length) return;
      this.att.push(...files);
      this.renderAtt();
      if (App.route !== 'home') App.go('home');
      const ta = U.$('#composer-input');
      if (ta) ta.focus();
    },

    renderAtt() {
      const box = U.$('#att-list');
      if (!box) return;
      box.innerHTML = this.attHtml();
      box.hidden = !this.att.length;
      this.updateChip();
    },

    async submit() {
      const ta = U.$('#composer-input');
      const sel = U.$('#composer-subj');
      const text = ta.value.trim();
      const subjectId = sel.value || null;
      if (!text && !this.att.length) return;

      const parsed = this.currentDue();
      const due = parsed ? parsed.due : null;
      const files = this.att.slice();
      let created = null;

      if (text) {
        const title = U.cap((parsed && parsed.clean) || text);
        const kind = App.Notify.guessKind(title);
        created = {
          id: U.uid(), title, kind, subjectId,
          due: due ? due.toISOString() : null,
          lead: App.Notify.defaultLead(kind, due),
          done: false, doneAt: null, createdAt: new Date().toISOString(),
        };
        Store.state.reminders.push(created);
        Store.save();
      }

      // Сбрасываем поле сразу — ответ интерфейса не должен ждать сохранения файлов
      ta.value = '';
      ta.style.height = '';
      this.att = [];
      this.manualDue = null;
      this.noParse = false;
      U.$('#composer-due').value = '';
      this.renderAtt();

      if (created) {
        App.refresh();
        const r = created;
        UI.toast(due ? `${r.kind === 'deadline' ? 'Дедлайн' : 'Напоминание'} · ${U.fmtWhen(due)}` : 'Добавлено в список дел', {
          action: { label: 'Изменить', fn: () => App.Notify.openModal(r) },
        });
        App.Notify.tick();
      }
      if (files.length) await App.Files.add(files, subjectId);
    },
  };

  Object.assign(App.actions, {
    'composer-attach': () => App.Files.pick((list) => Home.attach(list)),
    'composer-date': () => {
      const due = U.$('#composer-due');
      due.hidden = !due.hidden;
      if (!due.hidden) {
        const p = Home.currentDue();
        const base = p ? p.due : U.setMin(U.addDays(new Date(), 1), 9 * 60);
        due.value = U.toLocalInput(base);
        due.focus();
        try { due.showPicker && due.showPicker(); } catch (e) { /* не везде поддерживается */ }
      }
    },
    'date-clear': () => {
      if (Home.manualDue) Home.manualDue = null;
      else Home.noParse = true;
      U.$('#composer-due').value = '';
      Home.updateChip();
    },
    'att-remove': (el) => {
      Home.att.splice(Number(el.dataset.i), 1);
      Home.renderAtt();
    },
    'open-reminders': () => {
      App.Notify.tab = 'reminders';
      App.go('notifications');
    },
  });

  App.Home = Home;
})(window.App);
