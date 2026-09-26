/* Семестр — расписание Кировского ГМУ: разбор официальных таблиц и загрузка по группе */
(function (App) {
  'use strict';

  const U = App.U;

  /* ---------- Справочник дисциплин ----------
     Короткие названия для интерфейса и постоянные цвета. */
  const SUBJECTS = [
    { re: /^пропедевтика/, name: 'Пропедевтика внутренних болезней', hue: 18 },
    { re: /^общая хирургия/, name: 'Общая хирургия', hue: 210 },
    { re: /^фармакология/, name: 'Фармакология', hue: 145 },
    { re: /^микробиология/, name: 'Микробиология, вирусология', hue: 40 },
    { re: /^патофизиология/, name: 'Патофизиология', hue: 285 },
    { re: /^патологическая анатомия/, name: 'Патологическая анатомия', hue: 350 },
    { re: /^гигиена/, name: 'Гигиена', hue: 178 },
    { re: /^топографическая анатомия/, name: 'Топографическая анатомия и оперативная хирургия', hue: 248 },
    { re: /^электив.*физическ/, name: 'Физическая культура', hue: 95 },
    { re: /^дисциплина по выбору/, name: 'Дисциплина по выбору', hue: 8, elective: true, generic: true },
    { re: /^молекулярные механизмы/, name: 'Молекулярные механизмы в патологии человека', hue: 8, elective: true },
    { re: /^межкультурная/, name: 'Межкультурная профессиональная коммуникация', hue: 8, elective: true },
    { re: /^статистические методы/, name: 'Статистика в доказательной медицине', hue: 8, elective: true },
    { re: /^современные методы функциональной/, name: 'Функциональная диагностика донозологических состояний', hue: 8, elective: true },
    { re: /^латинская/, name: 'Латинская фармацевтическая терминология', hue: 8, elective: true },
    { re: /^диетология/, name: 'Диетология', hue: 8, elective: true },
    { re: /^биохимические основы/, name: 'Биохимические основы здорового образа жизни', hue: 8, elective: true },
  ];

  const DAY_LABELS = { 'ПН': 1, 'ВТ': 2, 'СР': 3, 'ЧТ': 4, 'ПТ': 5, 'СБ': 6, 'ВС': 7 };
  const MONTHS = { 'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12 };

  const T = '(\\d{1,2})[.:](\\d{2})';
  const TR = `${T}\\s*-\\s*${T}`;
  const D = '(\\d{1,2})\\.(\\d{2})';
  const LETTER = '[A-Za-zА-Яа-яЁё]';

  function canon(text) {
    const low = text.toLowerCase().replace(/^\s*(лекция|пр\.\s*занятие)\s*/i, '').trim();
    const hit = SUBJECTS.find((s) => s.re.test(low));
    if (hit) return hit;
    let name = text.replace(/\(.*$/, '').replace(/[\d№].*$/, '').replace(/[\s.,;:-]+$/, '').trim();
    if (name === name.toUpperCase()) name = U.cap(name.toLowerCase());
    return { name, hue: null, elective: /по выбору/i.test(text) };
  }

  const validTime = (h, m) => h >= 6 && h <= 22 && m < 60 && m % 5 === 0;
  const fmtTime = (h, m) => `${U.pad(h)}:${U.pad(m)}`;

  // Строки вида «8.00-9.30, 9.40-11.10» — пара из двух половин: берём начало первой и конец второй
  function readTimes(groups) {
    const n = groups.map((x) => (x === undefined ? NaN : Number(x)));
    const parts = [];
    for (let i = 0; i + 3 < n.length; i += 4) {
      const [h1, m1, h2, m2] = n.slice(i, i + 4);
      if ([h1, m1, h2, m2].some(Number.isNaN)) break;
      if (!validTime(h1, m1) || !validTime(h2, m2)) return null;
      parts.push([h1 * 60 + m1, h2 * 60 + m2]);
    }
    if (!parts.length || parts.some(([a, b]) => b <= a)) return null;
    return { start: U.fromMin(parts[0][0]), end: U.fromMin(parts[parts.length - 1][1]) };
  }

  function makeDateReader(sem) {
    // Месяцы семестра: осенний — сентябрь…январь, весенний — февраль…июль
    const fall = sem.getMonth() >= 7;
    return (dd, mm) => {
      const d = Number(dd);
      const m = Number(mm);
      if (fall ? !(m >= 8 || m === 1) : !(m >= 2 && m <= 7)) return null;
      const y = fall && m === 1 ? sem.getFullYear() + 1 : sem.getFullYear();
      const date = new Date(y, m - 1, d);
      if (date.getDate() !== d || date.getMonth() !== m - 1) return null;
      return U.ymd(date);
    };
  }

  /* ---------- Разбор одной ячейки ---------- */

  function parseCell(text, day, ctx) {
    const entryRe = new RegExp(`(?<![\\d.])${TR}(?:\\s*,\\s*${TR})?(?=\\s+${LETTER})`, 'g');
    const starts = [];
    let m;
    while ((m = entryRe.exec(text))) {
      const times = readTimes(m.slice(1, 9));
      if (times) starts.push({ index: m.index, len: m[0].length, times });
    }
    const out = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const body = text.slice(s.index + s.len, i + 1 < starts.length ? starts[i + 1].index : text.length).trim();
      const subj = canon(body);
      if (subj.generic) {
        // Сводные строки «Дисциплина по выбору» перечисляют разные курсы — берём общее время и период
        out.push(...parseBody(text.slice(s.index + s.len), s.times, day, ctx, subj, true));
        break;
      }
      out.push(...parseBody(body, s.times, day, ctx, subj, false));
    }
    return out;
  }

  function parseBody(body, times, day, ctx, subj, firstRangeOnly) {
    const date = ctx.readDate;
    let rest = ` ${body} `;
    const type = /^\s*лекция/i.test(body) ? 'lecture' : 'practice';

    // Место: «3 корпус, аудитория 803 ул. Владимирская, 112» или «3-114»
    let room = '';
    let place = '';
    const loc = rest.match(/(\d)\s*корпус,?\s*аудитория\s*(\d+)(?:,?\s*ул\.\s*([А-Яа-яЁё]+),?\s*(\d+))?/i);
    if (loc) {
      room = `${loc[1]}-${loc[2]}`;
      place = `${loc[1]} корпус${loc[3] ? `, ул. ${loc[3]}, ${loc[4]}` : ''}`;
      rest = rest.replace(loc[0], ' ');
    } else {
      const r = rest.match(/(?:^|\s)(\d)-(\d{3})(?=[\s),;]|$)/);
      if (r && !/ссылка\s*$/i.test(rest.slice(0, r.index + 1))) room = `${r[1]}-${r[2]}`;
      const dep = rest.match(/(?:на\s+)?(каф\.\s*[а-яё.\s]+?)(?=[),;]|\s\d|$)/i);
      if (dep) place = dep[1].replace(/\s+/g, ' ').trim();
    }
    rest = rest.replace(/\(\s*ссылка[^)]*\)/gi, ' ');
    if (subj.generic) { room = ''; place = ''; }

    const oneOffs = []; // разовые занятия со своим временем
    const pushOne = (dd, mm, t) => {
      const iso = date(dd, mm);
      if (iso && t) oneOffs.push({ date: iso, start: t.start, end: t.end });
      return iso && t ? ' ' : null;
    };
    // «27.11- 15.45-17.15», «9.00-10.30-06.11», «(… 23.12 8.00-11.10)»
    rest = rest.replace(new RegExp(`${D}\\s*-\\s*${TR}`, 'g'), (all, dd, mm, ...t) => pushOne(dd, mm, readTimes(t.slice(0, 4))) || all);
    rest = rest.replace(new RegExp(`${TR}\\s*-\\s*${D}(?!\\d)`, 'g'), (all, h1, m1, h2, m2, dd, mm) => pushOne(dd, mm, readTimes([h1, m1, h2, m2])) || all);
    rest = rest.replace(new RegExp(`${D}\\s+${TR}(?=\\s*\\))`, 'g'), (all, dd, mm, ...t) => pushOne(dd, mm, readTimes(t.slice(0, 4))) || all);

    const rules = [];
    // «1 неделя по 21.12» — через неделю до даты
    rest = rest.replace(new RegExp(`([12])\\s*неделя\\s+по\\s+${D}`, 'gi'), (all, w, dd, mm) => {
      const until = date(dd, mm);
      if (!until) return all;
      rules.push({ weeks: w === '1' ? 'odd' : 'even', from: ctx.semStart, until });
      return ' ';
    });
    // «07.09-28.12» — каждую неделю в этом периоде
    rest = rest.replace(new RegExp(`(?<![\\d.])${D}\\s*-\\s*${D}(?![\\d])`, 'g'), (all, d1, m1, d2, m2) => {
      const from = date(d1, m1);
      const until = date(d2, m2);
      if (!from || !until || until < from) return all;
      if (!(firstRangeOnly && rules.length)) rules.push({ weeks: 'all', from, until });
      return ' ';
    });
    // Отдельные даты: «14.09, 28.09, 12.10»
    const singles = [];
    if (!firstRangeOnly) {
      rest.replace(new RegExp(`(?<![\\d.])${D}(?![\\d])`, 'g'), (all, dd, mm) => {
        const iso = date(dd, mm);
        if (iso && !singles.includes(iso)) singles.push(iso);
        return all;
      });
    }

    const base = {
      day, subject: subj.name, hue: subj.hue, elective: !!subj.elective,
      type, room, place,
    };
    const out = rules.map((r) => Object.assign({}, base, times, r));
    if (singles.length) out.push(Object.assign({}, base, times, { dates: singles.sort() }));
    // Разовые занятия с одинаковым временем объединяем
    const byTime = {};
    oneOffs.forEach((o) => {
      const k = `${o.start}-${o.end}`;
      (byTime[k] = byTime[k] || { start: o.start, end: o.end, dates: [] }).dates.push(o.date);
    });
    Object.values(byTime).forEach((o) => out.push(Object.assign({}, base, o, { dates: o.dates.sort() })));
    if (!out.length) out.push(Object.assign({}, base, times, { weeks: 'all', from: ctx.semStart }));
    return out;
  }

  /* ---------- Разбор листа ---------- */

  function parseSheet({ grid, merges = [] }) {
    const cell = (r, c) => String((grid[r] || [])[c] || '').replace(/\s+/g, ' ').trim();
    const rows = grid.length;
    const all = grid.map((row) => (row || []).join(' ')).join(' ');

    // Начало семестра: «Начало семестра 01 сентября 2026 г.»
    let sem = null;
    const sm = all.match(/Начало семестра\s+(\d{1,2})\s+([а-я]+)\s+(\d{4})/i);
    if (sm && MONTHS[sm[2].toLowerCase()]) sem = new Date(Number(sm[3]), MONTHS[sm[2].toLowerCase()] - 1, Number(sm[1]));
    if (!sem) {
      const y = all.match(/(\d{4})\s*-\s*(\d{4})\s*учебного/);
      const half = /втор\S* полугоди/i.test(all);
      sem = y ? new Date(Number(half ? y[2] : y[1]), half ? 1 : 8, 1) : new Date(new Date().getFullYear(), 8, 1);
    }
    const ctx = { semStart: U.ymd(sem), readDate: makeDateReader(sem) };

    const titleCell = all.match(/РАСПИСАНИЕ ЗАНЯТИЙ[^.]*?(\(\s*\d\s*поток\s*\))/i);
    const stream = titleCell ? titleCell[1].replace(/[()]/g, '').trim() : '';
    const course = (all.match(/(\d)\s*КУРСА/i) || [])[1] || '';

    // Строка с номерами групп
    let headRow = -1;
    const colGroup = {};
    for (let r = 0; r < rows && headRow < 0; r++) {
      (grid[r] || []).forEach((v, c) => {
        const g = String(v || '').match(/групп\S*\s*(\d{3})/i);
        if (g) { colGroup[c] = g[1]; headRow = r; }
      });
    }
    if (headRow < 0) throw new Error('В таблице не нашлась строка с номерами групп');

    const mergeAt = {};
    merges.forEach(([r1, c1, , c2]) => { mergeAt[`${r1}:${c1}`] = c2; });

    const entries = [];
    let day = null;
    let r = headRow + 1;
    for (; r < rows; r++) {
      const a = cell(r, 0);
      if (/^\d\s*неделя\s*-/i.test(a) || /^Дисциплина$/i.test(a) || /^\d\s*неделя\s*-/i.test(cell(r, 1))) break;
      const label = a.toUpperCase().replace(/[^А-ЯЁ]/g, '');
      if (DAY_LABELS[label]) day = DAY_LABELS[label];
      if (!day) continue;
      const width = Math.max((grid[r] || []).length, 1);
      for (let c = 1; c < width; c++) {
        const text = cell(r, c);
        if (!text) continue;
        const c2 = mergeAt[`${r}:${c}`] != null ? mergeAt[`${r}:${c}`] : c;
        const groups = [];
        for (let k = c; k <= c2; k++) if (colGroup[k]) groups.push(colGroup[k]);
        if (!groups.length) continue;
        parseCell(text, day, ctx).forEach((e) => entries.push(Object.assign(e, { groups })));
      }
    }

    // Таблица «Дисциплина — Кафедра — База — Форма аттестации»
    const legend = {};
    for (; r < rows; r++) if ((grid[r] || []).some((v) => /^\s*Дисциплина\s*$/i.test(String(v || '')))) break;
    if (r < rows) {
      const blocks = [];
      (grid[r] || []).forEach((v, c) => {
        const h = String(v || '').trim().toLowerCase();
        if (h === 'дисциплина') blocks.push({ disc: c });
        const b = blocks[blocks.length - 1];
        if (!b) return;
        if (h.startsWith('кафедра')) b.dep = c;
        if (h.includes('база')) b.base = c;
        if (h.startsWith('форма')) b.exam = c;
      });
      for (let rr = r + 1; rr < rows; rr++) {
        blocks.forEach((b) => {
          const disc = cell(rr, b.disc);
          if (!disc || /начальник/i.test(disc)) return;
          const s = canon(disc);
          const dep = b.dep != null ? cell(rr, b.dep) : '';
          const base = b.base != null && b.base !== b.dep ? cell(rr, b.base) : '';
          const parts = [dep && !/^(клиника|на кафедрах)/i.test(dep) && !/^каф/i.test(dep) ? `каф. ${dep}` : dep, base].filter(Boolean);
          legend[s.name] = { place: shortPlace(parts.join(' / ')), exam: b.exam != null ? cell(rr, b.exam) : '' };
        });
      }
    }
    entries.forEach((e) => {
      if (!e.place && legend[e.subject] && e.type !== 'lecture') e.place = legend[e.subject].place;
    });

    return {
      stream, course, semStart: ctx.semStart,
      groups: Object.values(colGroup),
      entries, legend,
    };
  }

  function shortPlace(s) {
    return s
      .replace(/КОГКБУЗ\s*"Больница скорой медицинской помощи"/g, 'БСМП')
      .replace(/ЧУЗ\s*"\s*(?:Клиническая больница\s*"?|КБ\s*)РЖД-Медицина"?\s*(?:города|г\.)\s*Киров"?/g, 'КБ «РЖД-Медицина»')
      .replace(/проспект/g, 'пр.')
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/,(\S)/g, ', $1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const KGMU = {
    SUBJECTS,
    parseSheet,
    parseCell: (text, day, sem = '2026-09-01') => parseCell(text, day, { semStart: sem, readDate: makeDateReader(U.parseYmd(sem)) }),
    _parsed: null,

    parsed() {
      if (this._parsed) return this._parsed;
      const custom = App.Store && App.Store.state && App.Store.state.kgmuCustom;
      const data = custom && custom.streams ? custom : App.KGMU_DATA;
      if (!data) return null;
      const streams = data.streams.map((s) => Object.assign(parseSheet(s), { file: s.file }));
      this._parsed = { title: data.title, updated: data.updated, page: data.page || App.KGMU_DATA.page, custom: !!custom, streams };
      return this._parsed;
    },

    groups() {
      const p = this.parsed();
      return p ? p.streams.map((s) => ({ stream: s.stream, groups: s.groups })) : [];
    },

    entriesFor(group) {
      const p = this.parsed();
      if (!p) return [];
      const s = p.streams.find((x) => x.groups.includes(String(group)));
      return s ? s.entries.filter((e) => e.groups.includes(String(group))) : [];
    },

    legendFor(group) {
      const p = this.parsed();
      const s = p && p.streams.find((x) => x.groups.includes(String(group)));
      return s ? s.legend : {};
    },
  };

  /* ---------- Загрузка в расписание ---------- */

  Object.assign(KGMU, {
    available() {
      return !!this.parsed();
    },

    hasImported() {
      return App.Store.state.classes.some((c) => c.source === 'kgmu');
    },

    // Сводка по дисциплинам группы для окна предпросмотра
    summary(group) {
      const legend = this.legendFor(group);
      const map = new Map();
      this.entriesFor(group).forEach((e) => {
        const item = map.get(e.subject) || { name: e.subject, hue: e.hue, elective: e.elective, types: new Set(), count: 0 };
        item.types.add(e.type);
        item.count++;
        map.set(e.subject, item);
      });
      return [...map.values()]
        .map((it) => Object.assign(it, { exam: (legend[it.name] || {}).exam || '' }))
        .sort((a, b) => (a.elective - b.elective) || a.name.localeCompare(b.name, 'ru'));
    },

    apply(group, include) {
      const { Store, UI } = App;
      const st = Store.state;
      const removed = st.classes.filter((c) => c.source === 'kgmu').length;
      st.classes = st.classes.filter((c) => c.source !== 'kgmu');
      const entries = this.entriesFor(group).filter((e) => include.has(e.subject));
      entries.forEach((e) => {
        const subject = Store.subjectByName(e.subject);
        const c = {
          id: U.uid() + Math.random().toString(36).slice(2, 4),
          subjectId: subject.id, type: e.type, day: e.day, start: e.start, end: e.end,
          room: e.room || '', place: e.place || '', teacher: '', weeks: e.weeks || 'all',
          source: 'kgmu',
        };
        if (e.from) c.from = e.from;
        if (e.until) c.until = e.until;
        if (e.dates) c.dates = e.dates.slice();
        st.classes.push(c);
      });
      const p = this.parsed();
      const sheet = p.streams.find((x) => x.groups.includes(String(group)));
      st.profile.group = String(group);
      if (sheet && sheet.course) st.profile.course = Number(sheet.course);
      if (sheet && sheet.semStart) st.settings.semesterStart = sheet.semStart;
      st.settings.weekNames = 'num';
      Store.gcSubjects();
      Store.save();
      App.Schedule.animateBlocks = true;
      App.Schedule.weekOffset = 0;
      if (App.route === 'schedule') App.renderView(false);
      else App.go('schedule');
      App.renderSidebar();
      UI.toast(`Расписание группы ${group} ${removed ? 'обновлено' : 'загружено'}`);
    },

    openImport(group) {
      const { Store, UI } = App;
      const esc = U.esc;
      const p = this.parsed();
      if (!p) return;
      let current = String(group || Store.state.profile.group || p.streams[0].groups[0]);
      const manual = Store.state.classes.filter((c) => c.source !== 'kgmu' && !c.sample).length;
      const updated = U.parseYmd(p.updated || '2026-09-02');

      const list = () => {
        const items = this.summary(current);
        if (!items.length) return '<div class="empty"><p>Для этой группы в таблице нет занятий.</p></div>';
        return items.map((it, i) => {
          const types = [...it.types].map((t) => (t === 'lecture' ? 'лекции' : 'практические')).join(' и ');
          const meta = [types, it.exam, it.elective && 'по выбору — отметьте, если записаны'].filter(Boolean).join(' · ');
          return `
            <label class="kg-row" for="kg-s-${i}" style="--h:${it.hue != null ? it.hue : 40}">
              <input type="checkbox" id="kg-s-${i}" value="${esc(it.name)}" ${it.elective ? '' : 'checked'}>
              <span class="dot"></span>
              <span class="kg-text"><span class="kg-name">${esc(it.name)}</span><span class="kg-meta">${esc(U.cap(meta))}</span></span>
            </label>`;
        }).join('');
      };

      UI.modal({
        title: 'Расписание группы',
        body: `
          <div class="form-grid">
            <div class="field span-2">
              <label for="kg-group">Группа</label>
              <select id="kg-group" class="input">
                ${p.streams.map((st) => `<optgroup label="${esc(st.stream || 'Поток')}">${st.groups.map((g) => `<option value="${g}" ${g === current ? 'selected' : ''}>${g}</option>`).join('')}</optgroup>`).join('')}
              </select>
            </div>
            <div class="field span-2">
              <span class="field-label">Что загрузить</span>
              <div class="kg-list" id="kg-list">${list()}</div>
            </div>
            <p class="field-hint span-2">Источник: официальное расписание лечебного факультета с сайта kirovgma.ru${p.custom ? ', загруженное вами' : `, версия от ${U.fmtDate(updated)}`}. Если на кафедре что-то поменяли, пару можно исправить вручную.${manual ? ' Пары, которые вы добавили сами, останутся.' : ''}</p>
          </div>`,
        foot: `
          <button class="btn btn-ghost" type="button" data-close>Отмена</button>
          <button class="btn btn-primary" type="button" data-go>${this.hasImported() ? 'Обновить расписание' : 'Загрузить расписание'}</button>`,
        onMount: (el, api) => {
          const box = el.querySelector('#kg-list');
          el.querySelector('#kg-group').addEventListener('change', (e) => {
            current = e.target.value;
            box.innerHTML = list();
          });
          el.querySelector('[data-go]').addEventListener('click', () => {
            const include = new Set(U.$$('input[type=checkbox]:checked', box).map((x) => x.value));
            if (!include.size) { UI.toast('Отметьте хотя бы одну дисциплину'); return; }
            api.close();
            this.apply(current, include);
          });
        },
      });
    },

    /* ---------- Обновление из свежего файла ---------- */

    loadSheetJS() {
      if (window.XLSX) return Promise.resolve(window.XLSX);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('no XLSX')));
        s.onerror = () => reject(new Error('load failed'));
        document.head.appendChild(s);
      });
    },

    upload() {
      const { Store, UI } = App;
      App.Files.pick(async (files) => {
        const file = files[0];
        let XLSX;
        try { XLSX = await this.loadSheetJS(); } catch (e) {
          UI.toast('Не удалось загрузить модуль чтения Excel — проверьте интернет и попробуйте ещё раз');
          return;
        }
        let stream;
        try {
          const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const range = XLSX.utils.decode_range(ws['!ref']);
          const grid = [];
          for (let r = 0; r <= range.e.r; r++) {
            const row = [];
            for (let c = 0; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })];
              row.push(cell ? String(cell.w != null ? cell.w : cell.v).replace(/\s+/g, ' ').trim() : '');
            }
            grid.push(row);
          }
          const merges = (ws['!merges'] || []).map((m) => [m.s.r, m.s.c, m.e.r, m.e.c]);
          stream = { file: file.name, grid, merges };
          const test = parseSheet(stream);
          if (!test.entries.length) throw new Error('empty');
        } catch (e) {
          UI.toast('В файле не нашлось расписания по группам. Нужен .xlsx со страницы «Расписание. Лечебный факультет»', { timeout: 7000 });
          return;
        }
        const base = Store.state.kgmuCustom || { title: App.KGMU_DATA.title, page: App.KGMU_DATA.page, streams: App.KGMU_DATA.streams };
        const groups = new Set(parseSheet(stream).groups);
        const streams = base.streams.filter((s) => !parseSheet(s).groups.some((g) => groups.has(g)));
        streams.push(stream);
        Store.state.kgmuCustom = { title: base.title, page: base.page, updated: U.ymd(new Date()), streams };
        Store.save();
        this._parsed = null;
        UI.toast(`Файл «${file.name}» прочитан: группы ${[...groups].join(', ')}`);
        if (App.route === 'settings') App.renderView(false);
        this.openImport(groups.has(Store.state.profile.group) ? Store.state.profile.group : [...groups][0]);
      }, '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    },

    resetData() {
      App.Store.state.kgmuCustom = null;
      App.Store.save();
      this._parsed = null;
      App.UI.toast('Снова используется встроенное расписание от 2 сентября');
      if (App.route === 'settings') App.renderView(false);
    },

    /* ---------- Карточка на главной ---------- */

    onboardCard() {
      const { Store } = App;
      if (!this.available() || this.hasImported() || Store.state.settings.hideOnboard) return '';
      const ico = U.ico;
      let i = 0;
      return `
        <section class="onboard rise" style="--i:6">
          <div class="onboard-head">
            <div>
              <h2 class="onboard-title">Какая у вас группа?</h2>
              <p class="onboard-sub">Загрузим официальное расписание 3 курса лечебного факультета Кировского ГМУ на первое полугодие: лекции, практические, 1 и 2 недели, кафедры и клиники.</p>
            </div>
            <button class="icon-btn sm" data-action="kgmu-dismiss" aria-label="Скрыть">${ico('x')}</button>
          </div>
          <div class="onboard-streams">
            ${this.groups().map((s) => `
              <div class="stream">
                <span class="stream-label">${U.esc(s.stream || 'Поток')}</span>
                <div class="group-chips">${s.groups.map((g) => `<button class="group-chip" data-action="kgmu-group" data-group="${g}" style="--i:${i++}">${g}</button>`).join('')}</div>
              </div>`).join('')}
          </div>
        </section>`;
    },
  });

  Object.assign(App.actions, {
    'kgmu-group': (el) => KGMU.openImport(el.dataset.group),
    'kgmu-import': () => KGMU.openImport(),
    'kgmu-upload': () => KGMU.upload(),
    'kgmu-reset-data': () => KGMU.resetData(),
    'kgmu-dismiss': () => {
      App.Store.state.settings.hideOnboard = true;
      App.Store.save();
      App.refresh();
      App.UI.toast('Расписание группы можно загрузить позже в настройках');
    },
  });

  App.KGMU = KGMU;
})(window.App);
