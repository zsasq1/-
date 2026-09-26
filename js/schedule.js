/* Семестр — расписание: неделя, числитель/знаменатель, редактор пар */
(function (App) {
  'use strict';

  const { U, Store, UI } = App;
  const { esc, ico } = U;

  const PPM = 1.05; // пикселей на минуту в сетке недели

  // Нерабочие праздничные дни — занятий нет
  const HOLIDAYS = {
    '2026-11-04': 'День народного единства',
    '2027-01-01': 'Новогодние каникулы', '2027-01-02': 'Новогодние каникулы', '2027-01-03': 'Новогодние каникулы',
    '2027-01-04': 'Новогодние каникулы', '2027-01-05': 'Новогодние каникулы', '2027-01-06': 'Новогодние каникулы',
    '2027-01-07': 'Рождество', '2027-01-08': 'Новогодние каникулы',
    '2027-02-23': 'День защитника Отечества', '2027-03-08': 'Международный женский день',
    '2027-05-01': 'Праздник весны и труда', '2027-05-09': 'День Победы', '2027-06-12': 'День России',
  };

  const Sched = {
    weekOffset: 0,
    animateBlocks: false,

    /* ---------- Логика ---------- */

    parity(date) {
      const start = U.parseYmd(Store.state.settings.semesterStart);
      const week = Math.floor(U.dayDiff(U.mondayOf(start), U.mondayOf(date)) / 7) + 1;
      const odd = ((week % 2) + 2) % 2 === 1;
      return { week, odd, label: odd ? 'числитель' : 'знаменатель' };
    },

    // В КГМУ чередование называют «1 неделя» и «2 неделя», в других вузах — числитель и знаменатель
    weekName(odd, short = false) {
      const num = (Store.state.settings.weekNames || 'num') === 'num';
      if (short) return num ? (odd ? '1 нед' : '2 нед') : (odd ? 'чис' : 'знам');
      return num ? (odd ? '1 неделя' : '2 неделя') : (odd ? 'числитель' : 'знаменатель');
    },

    weekLabel(p) {
      return p.week >= 1 ? `${p.week}-я учебная неделя` : 'до начала семестра';
    },

    weekPill(p) {
      return `<span class="pill ${p.odd ? 'accent' : ''}">${esc(U.cap(this.weekName(p.odd)))}</span>`;
    },

    holiday(date) {
      return HOLIDAYS[typeof date === 'string' ? date : U.ymd(date)] || null;
    },

    matches(c, date) {
      const iso = U.ymd(date);
      if (HOLIDAYS[iso]) return false;
      if (c.dates && c.dates.length) return c.dates.includes(iso);
      if (Number(c.day) !== U.isoDay(date)) return false;
      if (c.from && iso < c.from) return false;
      if (c.until && iso > c.until) return false;
      if (c.weeks === 'odd' || c.weeks === 'even') return (c.weeks === 'odd') === this.parity(date).odd;
      return true;
    },

    // «30.11, 14.12» → ISO-даты в пределах учебного года
    parseDates(text) {
      const sem = U.parseYmd(Store.state.settings.semesterStart);
      const fall = sem.getMonth() >= 7;
      const out = [];
      String(text || '').split(/[\s,;]+/).forEach((tok) => {
        const m = tok.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
        if (!m) return;
        const d = Number(m[1]);
        const mo = Number(m[2]);
        let y = m[3] ? Number(m[3]) : (fall && mo < 8 ? sem.getFullYear() + 1 : sem.getFullYear());
        if (y < 100) y += 2000;
        const date = new Date(y, mo - 1, d);
        if (date.getDate() === d && date.getMonth() === mo - 1) out.push(U.ymd(date));
      });
      return [...new Set(out)].sort();
    },

    fmtDates(list) {
      return (list || []).map((iso) => `${iso.slice(8)}.${iso.slice(5, 7)}`).join(', ');
    },

    placeShort(c) {
      return (c.place || '').split(/[(,/]/)[0].trim();
    },

    classesOn(date) {
      return Store.state.classes
        .filter((c) => this.matches(c, date))
        .sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
    },

    nextDayWithClasses(from, maxDays = 14) {
      for (let i = 0; i < maxDays; i++) {
        const d = U.addDays(from, i);
        const list = this.classesOn(d);
        if (list.length) return { date: d, list };
      }
      return null;
    },

    status(c, date, now) {
      if (!U.sameDay(date, now)) return U.startOfDay(date) < U.startOfDay(now) ? 'past' : 'later';
      const m = now.getHours() * 60 + now.getMinutes();
      if (m >= U.toMin(c.end)) return 'past';
      if (m >= U.toMin(c.start)) return 'now';
      return 'later';
    },

    roomText(c) {
      return c.room ? (/^\d/.test(c.room) ? `ауд. ${c.room}` : c.room) : '';
    },

    // Коротко для блока в сетке, подробно — для списка и уведомлений
    metaLine(c, full = true) {
      const where = this.roomText(c) || this.placeShort(c);
      return [Store.CLASS_TYPES[c.type], where, full && c.teacher].filter(Boolean).join(' · ');
    },

    /* ---------- Экран ---------- */

    render() {
      const st = Store.state;
      const now = new Date();
      const monday = U.addDays(U.mondayOf(now), this.weekOffset * 7);
      const p = this.parity(monday);
      const showSun = st.settings.showSunday || st.classes.some((c) => Number(c.day) === 7);
      const days = showSun ? 7 : 6;
      const dates = Array.from({ length: days }, (_, i) => U.addDays(monday, i));
      const perDay = dates.map((d) => this.classesOn(d));
      const total = perDay.reduce((a, l) => a + l.length, 0);
      const last = dates[dates.length - 1];
      const range = monday.getMonth() === last.getMonth()
        ? `${monday.getDate()}–${last.getDate()} ${U.MONTHS_GEN[last.getMonth()]}`
        : `${U.fmtDate(monday)} – ${U.fmtDate(last)}`;

      const html = `
        <div class="page-head rise" style="--i:0">
          <div>
            <h1 class="page-title">Расписание</h1>
            <p class="page-sub">${this.weekPill(p)}${esc(this.weekLabel(p))} · ${total ? U.count(total, ['занятие', 'занятия', 'занятий']) + ' на неделе' : 'занятий нет'}</p>
          </div>
          <div class="head-actions">
            <div class="week-nav">
              <button class="btn btn-sm btn-ghost today-btn ${this.weekOffset === 0 ? 'is-off' : ''}" data-action="week-today" ${this.weekOffset === 0 ? 'tabindex="-1" aria-hidden="true"' : ''}>Сегодня</button>
              <button class="icon-btn" data-action="week-prev" aria-label="Предыдущая неделя">${ico('chevron-left')}</button>
              <span class="week-range">${range}</span>
              <button class="icon-btn" data-action="week-next" aria-label="Следующая неделя">${ico('chevron-right')}</button>
            </div>
            <button class="btn btn-primary" data-action="class-new">${ico('plus')} Занятие</button>
          </div>
        </div>
        ${st.classes.length ? '' : `
        <div class="banner sched-hint rise" style="--i:1">${ico('info')}
          <div class="banner-text">Расписание пока пустое. Загрузите официальное расписание своей группы или нажмите на свободное место в сетке, чтобы добавить пару вручную.</div>
          ${App.KGMU && App.KGMU.parsed() ? '<div class="banner-actions"><button class="btn btn-sm" data-action="kgmu-import">Выбрать группу</button></div>' : ''}
        </div>`}
        ${this.renderWeek(dates, perDay, now)}
        ${this.renderAgenda(dates, perDay, now)}`;
      this.animateBlocks = false;
      this.renderedDay = U.ymd(now);
      return html;
    },

    range() {
      let minM = 8 * 60;
      let maxM = 18 * 60;
      Store.state.classes.forEach((c) => {
        minM = Math.min(minM, Math.floor(U.toMin(c.start) / 60) * 60);
        maxM = Math.max(maxM, Math.ceil(U.toMin(c.end) / 60) * 60);
      });
      return { minM, maxM };
    },

    renderWeek(dates, perDay, now) {
      const { minM, maxM } = this.range();
      const bodyH = (maxM - minM) * PPM;
      const hours = [];
      for (let m = minM; m <= maxM; m += 60) hours.push(m);
      let idx = 0;

      const cols = dates.map((d, di) => {
        const isToday = U.sameDay(d, now);
        const blocks = layout(perDay[di]).map(({ c, s, e, lane, lanes }) => {
          const top = (s - minM) * PPM;
          const h = Math.max(26, (e - s) * PPM - 3);
          const status = this.status(c, d, now);
          const subj = Store.subject(c.subjectId);
          const compact = h < 58;
          const topic = App.Topics ? App.Topics.line(c, d) : null;
          const style = `${Store.subjStyle(c.subjectId)};--i:${idx++};top:calc(var(--pad) + ${top}px);height:${h}px;left:calc(${(lane / lanes) * 100}% + 4px);width:calc(${100 / lanes}% - 8px)`;
          return `
            <button class="cls ${compact ? 'is-compact' : ''} ${status === 'now' ? 'is-now' : ''} ${status === 'past' && isToday ? 'is-past' : ''} ${Store.subjClass(c.subjectId)}"
              style="${style}" data-action="occ-open" data-id="${c.id}" data-date="${U.ymd(d)}"
              title="${esc(topic ? topic.text : '')}"
              aria-label="${esc(`${subj ? subj.name : 'Пара'}, ${c.start}–${c.end}${topic ? `. Тема: ${topic.text}` : ''}`)}">
              <span class="cls-time">${c.start}–${c.end}${topic && topic.final ? ' <b class="cls-final">итог.</b>' : ''}</span>
              <span class="cls-name">${esc(subj ? subj.name : 'Без названия')}</span>
              ${compact ? '' : `<span class="cls-meta">${esc(this.metaLine(c, false))}</span>`}
              ${topic && !compact ? `<span class="cls-topic">${esc(topic.text)}</span>` : ''}
              ${(c.weeks === 'odd' || c.weeks === 'even') && !(c.dates && c.dates.length) && !compact ? `<span class="cls-weeks" title="Только ${esc(this.weekName(c.weeks === 'odd'))}">${this.weekName(c.weeks === 'odd', true)}</span>` : ''}
            </button>`;
        }).join('');
        const nowM = now.getHours() * 60 + now.getMinutes();
        const nowLine = isToday && nowM >= minM && nowM <= maxM
          ? `<div class="now-line" style="top:calc(var(--pad) + ${(nowM - minM) * PPM}px)"></div>` : '';
        const hol = this.holiday(d);
        return `<div class="wk-col ${isToday ? 'is-today' : ''} ${hol ? 'is-holiday' : ''}" data-action="slot" data-date="${U.ymd(d)}" data-min="${minM}">${hol ? `<span class="wk-holiday">${esc(hol)}<br>занятий нет</span>` : ''}${blocks}${nowLine}</div>`;
      }).join('');

      const heads = dates.map((d) => `
        <div class="wk-head ${U.sameDay(d, now) ? 'is-today' : ''}"><span>${U.DAYS_SHORT[U.isoDay(d)]}</span><span class="dnum">${d.getDate()}</span></div>`).join('');
      const times = hours.map((m) => `<span style="top:calc(var(--pad) + ${(m - minM) * PPM}px)">${U.fromMin(m)}</span>`).join('');

      return `
        <div class="week-wrap rise" style="--i:2">
          <div class="week ${this.animateBlocks ? 'animate-blocks' : ''}" style="--cols:${dates.length};--body-h:${bodyH}px;--hour-h:${60 * PPM}px">
            <div class="wk-corner"></div>${heads}
            <div class="wk-times">${times}</div>${cols}
          </div>
        </div>`;
    },

    renderAgenda(dates, perDay, now) {
      return `
        <div class="agenda rise" style="--i:2">
          ${dates.map((d, i) => {
            const isToday = U.sameDay(d, now);
            const list = perDay[i];
            return `
              <section class="ag-day ${isToday ? 'is-today' : ''}">
                <h3>${U.cap(U.DAYS[U.isoDay(d)])} <span>${U.fmtDate(d)}</span>${isToday ? '<span class="pill accent">сегодня</span>' : ''}</h3>
                <div class="ag-list">
                  ${list.length ? list.map((c) => {
                    const subj = Store.subject(c.subjectId);
                    const topic = App.Topics ? App.Topics.line(c, d) : null;
                    return `
                      <button class="ag-item ${this.status(c, d, now) === 'now' ? 'is-now' : ''} ${Store.subjClass(c.subjectId)}" style="${Store.subjStyle(c.subjectId)}" data-action="occ-open" data-id="${c.id}" data-date="${U.ymd(d)}">
                        <span class="ag-time"><b>${c.start}</b>${c.end}</span>
                        <span><span class="ag-name">${esc(subj ? subj.name : 'Без названия')}${topic && topic.final ? ' <span class="ag-final">итоговое</span>' : ''}</span><span class="ag-meta">${esc([Store.CLASS_TYPES[c.type], this.roomText(c), c.place, c.teacher].filter(Boolean).join(' · '))}</span>${topic ? `<span class="ag-topic">${esc(topic.text)}</span>` : ''}</span>
                      </button>`;
                  }).join('') : this.holiday(d) ? `<p class="ag-empty">${esc(this.holiday(d))} — занятий нет</p>` : `<button class="ag-empty" data-action="class-new" data-day="${U.isoDay(d)}">Нет занятий — добавить</button>`}
                </div>
              </section>`;
          }).join('')}
        </div>`;
    },

    onMinute(view) {
      // Перерисовываем сетку только на границах пар и при смене дня,
      // в остальное время просто сдвигаем линию «сейчас»
      const now = new Date();
      const hm = U.hm(now);
      const nowM = now.getHours() * 60 + now.getMinutes();
      const { minM, maxM } = this.range();
      const line = U.$('.now-line', view);
      const boundary = this.classesOn(now).some((c) => c.start === hm || c.end === hm);
      const lineMissing = !line && this.weekOffset === 0 && nowM >= minM && nowM <= maxM;
      if (boundary || lineMissing || U.ymd(now) !== this.renderedDay) {
        App.renderView(false);
        return;
      }
      if (line) line.style.top = `calc(var(--pad) + ${(nowM - minM) * PPM}px)`;
    },

    /* ---------- Редактор пары ---------- */

    openModal(cls, preset = {}) {
      const st = Store.state;
      const isEdit = !!cls;
      const today = U.isoDay(new Date());
      const c = cls || {
        subjectId: preset.subjectId || null,
        type: 'lecture',
        day: preset.day || (today === 7 && !st.settings.showSunday ? 1 : today),
        start: preset.start || Store.PAIRS[0][0],
        end: preset.end || Store.PAIRS[0][1],
        room: '', teacher: '', place: '', weeks: 'all',
      };
      const hasPeriod = !!(c.from || c.until || (c.dates && c.dates.length));
      const places = [...new Set(st.classes.map((x) => x.place).filter(Boolean))];
      const subj = Store.subject(c.subjectId);
      const hue = subj ? subj.hue : Store.nextHue();
      const pairIdx = Store.PAIRS.findIndex((p) => p[0] === c.start && p[1] === c.end);
      const subjects = Store.sortedSubjects();
      const teachers = [...new Set(st.classes.map((x) => x.teacher).filter(Boolean))];

      const body = `
        <form id="cf" class="form-grid" autocomplete="off" novalidate>
          ${c.source === 'kgmu' ? `<p class="field-hint span-2">Из официального расписания КГМУ. Если на кафедре что-то поменяли, исправьте здесь.</p>` : ''}
          <div class="field span-2">
            <label for="cf-subj">Предмет</label>
            <input id="cf-subj" class="input" list="cf-subj-list" placeholder="Например, Фармакология" value="${esc(subj ? subj.name : '')}" required>
            <datalist id="cf-subj-list">${subjects.map((s) => `<option value="${esc(s.name)}"></option>`).join('')}</datalist>
          </div>
          <div class="field span-2">
            <span class="field-label">Цвет предмета</span>
            <div class="swatches" role="radiogroup" aria-label="Цвет предмета">
              ${Store.HUES.map((h) => `<input type="radio" name="hue" id="cf-hue-${h}" value="${h}" ${h === hue ? 'checked' : ''}><label for="cf-hue-${h}" style="--h:${h}" title="Цвет"></label>`).join('')}
            </div>
          </div>
          <div class="field span-2">
            <span class="field-label">Тип занятия</span>
            ${UI.seg('cf-type', 'type', Store.CLASS_TYPES, c.type, 'full')}
          </div>
          <div class="field">
            <label for="cf-day">День недели</label>
            <select id="cf-day" class="input">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(c.day) === d ? 'selected' : ''}>${U.cap(U.DAYS[d])}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="cf-pair">Время</label>
            <select id="cf-pair" class="input">
              ${Store.PAIRS.map((p, i) => `<option value="${i}" ${i === pairIdx ? 'selected' : ''}>${p[0]}–${p[1]}</option>`).join('')}
              <option value="custom" ${pairIdx < 0 ? 'selected' : ''}>Своё время</option>
            </select>
          </div>
          <div class="field">
            <label for="cf-start">Начало</label>
            <input id="cf-start" type="time" class="input" value="${esc(c.start)}" required>
          </div>
          <div class="field">
            <label for="cf-end">Конец</label>
            <input id="cf-end" type="time" class="input" value="${esc(c.end)}" required>
          </div>
          <div class="field">
            <label for="cf-room">Аудитория</label>
            <input id="cf-room" class="input" placeholder="3-803" value="${esc(c.room)}">
          </div>
          <div class="field">
            <label for="cf-teacher">Преподаватель</label>
            <input id="cf-teacher" class="input" list="cf-teacher-list" placeholder="Иванов И. И." value="${esc(c.teacher)}">
            <datalist id="cf-teacher-list">${teachers.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
          </div>
          <div class="field span-2">
            <label for="cf-place">Место</label>
            <input id="cf-place" class="input" list="cf-place-list" placeholder="Кафедра, корпус или клиническая база" value="${esc(c.place || '')}">
            <datalist id="cf-place-list">${places.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
          </div>
          <div class="field span-2">
            <span class="field-label">Повторять</span>
            ${UI.seg('cf-weeks', 'weeks', { all: 'Каждую неделю', odd: U.cap(this.weekName(true)), even: U.cap(this.weekName(false)) }, c.weeks || 'all', 'full')}
          </div>
          <details class="span-2 more" ${hasPeriod ? 'open' : ''}>
            <summary>Период и отдельные даты</summary>
            <div class="form-grid more-body">
              <div class="field">
                <label for="cf-from">С</label>
                <input id="cf-from" type="date" class="input" value="${esc(c.from || '')}">
              </div>
              <div class="field">
                <label for="cf-until">По</label>
                <input id="cf-until" type="date" class="input" value="${esc(c.until || '')}">
              </div>
              <div class="field span-2">
                <label for="cf-dates">Только в эти даты</label>
                <input id="cf-dates" class="input" placeholder="30.11, 14.12" value="${esc(this.fmtDates(c.dates))}">
                <span class="field-hint">Если заполнено, занятие будет только в эти дни — день недели и повторение не учитываются.</span>
              </div>
            </div>
          </details>
          <p class="form-error span-2" id="cf-err" hidden></p>
        </form>`;

      const foot = `
        ${isEdit ? `<button class="btn btn-ghost btn-danger" type="button" data-del>${ico('trash')} Удалить</button><span class="spacer"></span>` : ''}
        <button class="btn btn-ghost" type="button" data-close>Отмена</button>
        <button class="btn btn-primary" type="submit" form="cf">${isEdit ? 'Сохранить' : 'Добавить'}</button>`;

      UI.modal({
        title: isEdit ? 'Занятие' : 'Новое занятие',
        body, foot,
        onMount: (el, api) => {
          const f = (id) => el.querySelector(`#${id}`);
          const subjInput = f('cf-subj');
          const pairSel = f('cf-pair');
          const startIn = f('cf-start');
          const endIn = f('cf-end');
          const err = f('cf-err');

          subjInput.addEventListener('input', () => {
            const found = Store.state.subjects.find((s) => s.name.toLowerCase() === subjInput.value.trim().toLowerCase());
            if (found) {
              const r = el.querySelector(`#cf-hue-${found.hue}`);
              if (r) r.checked = true;
            }
          });
          pairSel.addEventListener('change', () => {
            const p = Store.PAIRS[Number(pairSel.value)];
            if (p) { startIn.value = p[0]; endIn.value = p[1]; }
          });
          const syncPair = () => {
            const i = Store.PAIRS.findIndex((p) => p[0] === startIn.value && p[1] === endIn.value);
            pairSel.value = i >= 0 ? String(i) : 'custom';
          };
          startIn.addEventListener('change', () => {
            // Сохраняем длительность при сдвиге начала
            const dur = U.toMin(endIn.value) - U.toMin(startIn.value);
            if (!endIn.value || dur <= 0) endIn.value = U.fromMin(Math.min(U.toMin(startIn.value) + 90, 23 * 60 + 59));
            syncPair();
          });
          endIn.addEventListener('change', syncPair);

          if (isEdit) {
            el.querySelector('[data-del]').addEventListener('click', () => {
              api.close();
              this.remove(cls.id);
            });
          }

          el.querySelector('#cf').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = subjInput.value.trim();
            const s = U.toMin(startIn.value);
            const en = U.toMin(endIn.value);
            const fail = (msg, input) => { err.textContent = msg; err.hidden = false; if (input) input.focus(); };
            if (!name) return fail('Укажите предмет.', subjInput);
            if (!startIn.value || !endIn.value) return fail('Укажите время начала и конца.', startIn);
            if (en <= s) return fail('Занятие должно заканчиваться позже, чем начинается.', endIn);
            const from = f('cf-from').value;
            const until = f('cf-until').value;
            if (from && until && until < from) return fail('Дата окончания раньше даты начала.', f('cf-until'));
            const datesText = f('cf-dates').value.trim();
            const dates = this.parseDates(datesText);
            if (datesText && !dates.length) return fail('Не удалось разобрать даты. Пишите через запятую: 30.11, 14.12', f('cf-dates'));

            const hueVal = Number((el.querySelector('input[name=hue]:checked') || {}).value);
            const subject = Store.subjectByName(name, Number.isFinite(hueVal) ? hueVal : undefined);
            const data = {
              subjectId: subject.id,
              type: (el.querySelector('input[name=type]:checked') || {}).value || 'lecture',
              day: Number(f('cf-day').value),
              start: startIn.value,
              end: endIn.value,
              room: f('cf-room').value.trim(),
              teacher: f('cf-teacher').value.trim(),
              place: f('cf-place').value.trim(),
              weeks: (el.querySelector('input[name=weeks]:checked') || {}).value || 'all',
              from: from || undefined,
              until: until || undefined,
              dates: dates.length ? dates : undefined,
            };
            if (isEdit) {
              Object.assign(cls, data);
              ['from', 'until', 'dates'].forEach((k) => { if (data[k] === undefined) delete cls[k]; });
              delete cls.sample;
            } else {
              Store.state.classes.push(Object.assign({ id: U.uid() }, data));
            }
            Store.gcSubjects();
            Store.save();
            api.close();
            this.animateBlocks = true;
            App.refresh();
            UI.toast(isEdit ? 'Изменения сохранены' : dates.length ? `Занятие добавлено: ${this.fmtDates(dates)}` : `Занятие добавлено: ${U.DAYS_SHORT[data.day]}, ${data.start}`);
          });
        },
      });
    },

    remove(id) {
      const st = Store.state;
      const i = st.classes.findIndex((c) => c.id === id);
      if (i < 0) return;
      const [removed] = st.classes.splice(i, 1);
      const subjects = st.subjects.slice();
      Store.gcSubjects();
      Store.save();
      App.refresh();
      UI.toast('Занятие удалено', {
        action: {
          label: 'Вернуть',
          fn: () => {
            st.subjects = subjects;
            st.classes.splice(i, 0, removed);
            Store.save();
            App.refresh();
          },
        },
      });
    },

    slotClick(col, e) {
      if (e.target !== col) return;
      const rect = col.getBoundingClientRect();
      const pad = 10;
      const minute = Number(col.dataset.min) + (e.clientY - rect.top - pad) / PPM;
      const date = U.parseYmd(col.dataset.date);
      let pair = Store.PAIRS.find((p, i) => {
        const next = Store.PAIRS[i + 1];
        return minute >= U.toMin(p[0]) - 10 && (!next || minute < U.toMin(next[0]) - 10);
      });
      if (!pair) {
        const s = Math.max(0, Math.round(minute / 30) * 30);
        pair = [U.fromMin(s), U.fromMin(Math.min(s + 90, 23 * 60 + 59))];
      }
      this.openModal(null, { day: U.isoDay(date), start: pair[0], end: pair[1] });
    },
  };

  // Раскладка пересекающихся пар по колонкам
  function layout(list) {
    const out = [];
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = [];
      cluster.forEach((it) => {
        let l = lanes.findIndex((end) => end <= it.s);
        if (l < 0) { l = lanes.length; lanes.push(0); }
        lanes[l] = it.e;
        it.lane = l;
      });
      cluster.forEach((it) => { it.lanes = lanes.length; });
      out.push(...cluster);
      cluster = [];
      clusterEnd = -1;
    };
    list.forEach((c) => {
      const s = U.toMin(c.start);
      const e = U.toMin(c.end);
      if (cluster.length && s >= clusterEnd) flush();
      cluster.push({ c, s, e });
      clusterEnd = Math.max(clusterEnd, e);
    });
    if (cluster.length) flush();
    return out;
  }

  Object.assign(App.actions, {
    'week-prev': () => { Sched.weekOffset--; Sched.animateBlocks = true; App.renderView(false); },
    'week-next': () => { Sched.weekOffset++; Sched.animateBlocks = true; App.renderView(false); },
    'week-today': () => { Sched.weekOffset = 0; Sched.animateBlocks = true; App.renderView(false); },
    'class-new': (el) => Sched.openModal(null, el.dataset.day ? { day: Number(el.dataset.day) } : {}),
    'class-edit': (el) => {
      const c = Store.state.classes.find((x) => x.id === el.dataset.id);
      if (c) Sched.openModal(c);
    },
    slot: (el, e) => Sched.slotClick(el, e),
  });

  App.Schedule = Sched;
})(window.App);
