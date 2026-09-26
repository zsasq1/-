/* Семестр — состояние приложения (localStorage) и хранилище файлов (IndexedDB) */
(function (App) {
  'use strict';

  const U = App.U;
  const KEY = 'semestr.v1';

  // Оттенки предметов: подобраны так, чтобы различаться и в светлой, и в тёмной теме
  const HUES = [18, 210, 145, 40, 285, 350, 178, 95, 248, 8, 120, 318, 195, 62, 265, 332, 160, 228];

  // Частое время занятий в КГМУ: практические — два часа с перерывом, лекции — 90 минут
  const PAIRS = [
    ['08:00', '10:25'], ['08:00', '11:10'], ['08:30', '10:00'], ['10:30', '12:55'],
    ['10:40', '13:05'], ['11:00', '12:30'], ['13:00', '14:30'], ['13:05', '15:30'],
    ['15:45', '18:10'],
  ];

  const CLASS_TYPES = { lecture: 'Лекция', practice: 'Практика', lab: 'Лаба', seminar: 'Семинар' };
  const CLASS_TYPES_FULL = { lecture: 'Лекция', practice: 'Практическое занятие', lab: 'Лабораторная', seminar: 'Семинар' };

  function semesterStartFor(now) {
    const y = now.getFullYear();
    const m = now.getMonth();
    if (m >= 7) return `${y}-09-01`;      // август–декабрь: осенний семестр
    if (m === 0) return `${y - 1}-09-01`;  // январь: сессия осеннего
    return `${y}-02-09`;                   // весенний семестр
  }

  const Store = {
    KEY, HUES, PAIRS, CLASS_TYPES, CLASS_TYPES_FULL,
    VERSION: 2,
    DEFAULT_GROUP: '314',
    // Студент 314 группы записан на электив кафедры патофизиологии (пятница)
    DEFAULT_ELECTIVES: ['Электив на кафедре патофизиологии'],
    state: null,
    storageOk: true,
    firstRun: false,
    seedBlobs: null,

    defaults() {
      return {
        version: this.VERSION,
        profile: { name: '', university: 'Кировский ГМУ', program: 'Лечебное дело', course: 3, group: this.DEFAULT_GROUP },
        settings: {
          theme: 'system',
          classLead: 15,
          systemNotify: false,
          semesterStart: semesterStartFor(new Date()),
          weekNames: 'num',
          showSunday: false,
          sidebarCollapsed: false,
          filesView: 'grid',
          hideOnboard: false,
          autoImported: false,
          electivesSynced: false,
          electiveCourses: [],
        },
        subjects: [],
        classes: [],
        reminders: [],
        files: [],
        notifications: [],
        fired: {},
        sampleBanner: false,
        kgmuCustom: null,
        topicNotes: {},
      };
    },

    load() {
      const raw = U.ls.get(KEY);
      let data = null;
      if (raw) {
        try { data = JSON.parse(raw); } catch (e) { data = null; }
      }
      if (!data || typeof data !== 'object') {
        this.state = this.defaults();
        this.seed();
        this.firstRun = true;
        this.save();
        return;
      }
      this.state = this.normalize(data);
      this.fixHueClashes();
      this.save();
    },

    normalize(data) {
      const def = this.defaults();
      const st = Object.assign(def, data);
      st.settings = Object.assign(this.defaults().settings, data.settings || {});
      st.profile = Object.assign(this.defaults().profile, data.profile || {});
      ['subjects', 'classes', 'reminders', 'files', 'notifications'].forEach((k) => {
        if (!Array.isArray(st[k])) st[k] = [];
      });
      if (!st.fired || typeof st.fired !== 'object') st.fired = {};
      if (!st.topicNotes || typeof st.topicNotes !== 'object') st.topicNotes = {};
      // Раньше элективы хранились по дням недели: { 5: 'курс' }
      if (!Array.isArray(st.settings.electiveCourses)) st.settings.electiveCourses = [];
      if (st.settings.electives && !st.settings.electiveCourses.length) {
        st.settings.electiveCourses = [...new Set(Object.values(st.settings.electives).filter(Boolean))];
      }
      delete st.settings.electives;

      // Первая версия показывала общий пример (матанализ, Python) — меняем его на медицинский
      if ((data.version || 1) < 2) {
        const hadSample = ['classes', 'reminders', 'files'].some((k) => st[k].some((x) => x.sample));
        this.oldSampleFiles = st.files.filter((f) => f.sample).map((f) => f.id);
        ['classes', 'reminders', 'files'].forEach((k) => { st[k] = st[k].filter((x) => !x.sample); });
        st.settings.weekNames = 'num';
        this.state = st;
        this.gcSubjects();
        if (hadSample) this.seed(true);
        st.version = this.VERSION;
      }
      return st;
    },

    rev: 0, // растёт при каждом сохранении — по нему сбрасываются вычисленные кэши

    save() {
      this.rev++;
      this.storageOk = U.ls.set(KEY, JSON.stringify(this.state));
      return this.storageOk;
    },

    /* ---------- Предметы ---------- */

    subject(id) {
      return (id && this.state.subjects.find((s) => s.id === id)) || null;
    },

    nextHue() {
      const used = this.state.subjects.map((s) => s.hue);
      const free = HUES.find((h) => !used.includes(h));
      return free != null ? free : HUES[this.state.subjects.length % HUES.length];
    },

    // Раньше все дисциплины по выбору получали один цвет — разводим совпадения
    fixHueClashes() {
      const seen = new Set();
      this.state.subjects.forEach((s) => {
        if (seen.has(s.hue)) {
          const free = HUES.find((h) => !this.state.subjects.some((x) => x.hue === h));
          if (free != null) s.hue = free;
        }
        seen.add(s.hue);
      });
    },

    // Постоянный цвет для известных дисциплин, если он ещё не занят
    defaultHue(name) {
      const known = App.KGMU && App.KGMU.SUBJECTS.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (known && known.hue != null && !this.state.subjects.some((s) => s.hue === known.hue)) return known.hue;
      return this.nextHue();
    },

    subjectByName(name, hue) {
      const n = String(name || '').trim().replace(/\s+/g, ' ');
      if (!n) return null;
      let s = this.state.subjects.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (!s) {
        s = { id: U.uid(), name: n, hue: hue != null ? hue : this.defaultHue(n) };
        this.state.subjects.push(s);
      } else if (hue != null) {
        s.hue = hue;
      }
      return s;
    },

    sortedSubjects() {
      return this.state.subjects.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    },

    // Удаляет предметы, на которые больше ничего не ссылается
    gcSubjects() {
      const st = this.state;
      const used = new Set();
      st.classes.forEach((c) => used.add(c.subjectId));
      st.reminders.forEach((r) => used.add(r.subjectId));
      st.files.forEach((f) => used.add(f.subjectId));
      st.subjects = st.subjects.filter((s) => used.has(s.id));
    },

    // Стиль цвета для элемента, привязанного к предмету
    subjStyle(id) {
      const s = this.subject(id);
      return s ? `--h:${s.hue}` : '--h:40';
    },
    subjClass(id) {
      return this.subject(id) ? '' : 'no-subj';
    },

    hasSample() {
      const st = this.state;
      return [st.classes, st.reminders, st.files].some((list) => list.some((x) => x.sample));
    },

    profileLine() {
      const p = this.state.profile;
      return [p.course && `${p.course} курс`, p.group ? `гр. ${p.group}` : p.program].filter(Boolean).join(' · ');
    },

    /* ---------- Пример данных для первого запуска ----------
       Расписание не придумываем: его загружают из официальной таблицы КГМУ по номеру группы. */

    seed(keepNotifications = false) {
      const st = this.state;
      const now = new Date();
      const sub = {};
      const add = (key, name) => { sub[key] = this.subjectByName(name); };
      add('pharm', 'Фармакология');
      add('path', 'Патологическая анатомия');
      add('prop', 'Пропедевтика внутренних болезней');
      add('micro', 'Микробиология, вирусология');

      const at = (days, t) => U.atTime(U.addDays(now, days), t).toISOString();
      const rem = (title, subject, due, kind, lead, done = false) => ({
        id: U.uid(), title, subjectId: subject ? sub[subject].id : null, due, kind, lead, done,
        createdAt: now.toISOString(), doneAt: done ? now.toISOString() : null, sample: true,
      });
      st.reminders = st.reminders.concat([
        rem('Выучить схему расспроса больного: жалобы и анамнез', 'prop', at(1, '19:00'), 'reminder', 15),
        rem('Отработка по патанатомии за пропущенное занятие', 'path', at(3, '15:45'), 'deadline', 1440),
        rem('Контрольная по рецептуре: 20 рецептов', 'pharm', at(4, '09:20'), 'deadline', 1440),
        rem('Коллоквиум: стафилококки и стрептококки', 'micro', at(6, '08:00'), 'deadline', 1440),
        rem('Купить халат, шапочку и сменную обувь для клиники', null, null, 'reminder', 0, true),
      ]);

      const files = [
        { name: 'Рецептура — шпаргалка к контрольной.md', type: 'text/markdown', subject: 'pharm', body: SAMPLE_RECIPES },
        { name: 'Микропрепараты к итоговому занятию.txt', type: 'text/plain', subject: 'path', body: SAMPLE_MICRO },
        { name: 'Нормальная ЭКГ — схема.svg', type: 'image/svg+xml', subject: 'prop', body: ecgSvg() },
      ];
      this.seedBlobs = [];
      st.files = st.files.concat(files.map((f, i) => {
        const blob = new Blob([f.body], { type: f.type });
        const id = U.uid() + i;
        this.seedBlobs.push({ id, blob });
        return {
          id, name: f.name, size: blob.size, type: f.type, subjectId: sub[f.subject].id,
          addedAt: new Date(now.getTime() - (i + 1) * 3.6e6).toISOString(), sample: true,
        };
      }));

      if (!keepNotifications) {
        st.notifications = [
          {
            id: U.uid(), kind: 'system', read: false, at: new Date(now.getTime() - 6e4).toISOString(),
            title: 'Добро пожаловать в Семестр',
            body: 'Выберите свою группу на главной — расписание 3 курса лечебного факультета КГМУ загрузится само.',
            route: 'home',
          },
          {
            id: U.uid(), kind: 'file', read: true, at: new Date(now.getTime() - 36e5).toISOString(),
            title: 'Добавлено 3 файла', body: 'Примеры конспектов лежат в разделе «Файлы».', route: 'files',
          },
        ];
      }
      st.sampleBanner = true;
    },
  };

  const SAMPLE_RECIPES = `# Рецептура — шпаргалка к контрольной

Проверяйте формулировки по методичке кафедры фармакологии.

## Твёрдые формы
Rp.: Tabulettas Acidi acetylsalicylici 0,5 N. 20
D.S. По 1 таблетке 3 раза в день после еды.

## Жидкие формы
Rp.: Tincturae Valerianae 30 ml
D.S. По 20–30 капель 3 раза в день.

Rp.: Solutionis Glucosi 5% — 400 ml
Sterilisetur!
D.S. Для внутривенного капельного введения.

## Ампулы
Rp.: Solutionis Atropini sulfatis 0,1% — 1 ml
D.t.d. N. 6 in ampullis
S. Вводить подкожно по 1 мл.

## Мягкие формы
Rp.: Unguenti Tetracyclini 3% — 15,0
D.S. Наносить на поражённый участок кожи.

## Сокращения
- D.t.d. — Da tales doses, выдай такие дозы
- M.f. — Misce, fiat, смешай, пусть получится
- S. — Signa, обозначь
`;

  const SAMPLE_MICRO = `Микропрепараты к итоговому занятию
Общая патологическая анатомия

Дистрофии
1. Жировая дистрофия печени (окраска суданом III)
2. Гиалиноз стенок артериол почки
3. Амилоидоз почки (окраска конго красным)

Расстройства кровообращения
4. Бурая индурация лёгких (гемосидероз)
5. Мускатная печень (хроническое венозное полнокровие)
6. Геморрагический инфаркт лёгкого
7. Смешанный тромб

Некроз и воспаление
8. Ишемический инфаркт почки
9. Казеозный некроз в лимфатическом узле при туберкулёзе
10. Фибринозный перикардит

Для каждого препарата: орган, окраска, что видно при малом и большом увеличении.
`;

  // Схема нормальной ЭКГ на миллиметровке: зубцы, сегменты, интервалы
  function ecgSvg() {
    const base = 150;
    // 1 мм = 8 px; 25 мм/с → 1 мм = 0,04 с. ЧСС 60: RR = 25 мм
    const beat = (x) => [
      `L${x} ${base}`, `Q${x + 10} ${base - 14} ${x + 20} ${base}`,     // P, 0,10 с
      `L${x + 36} ${base}`, `L${x + 39} ${base + 8}`,                  // сегмент PQ, Q
      `L${x + 44} ${base - 92}`, `L${x + 50} ${base + 20}`,            // R, S
      `L${x + 54} ${base}`, `L${x + 80} ${base}`,                      // сегмент ST
      `Q${x + 101} ${base - 40} ${x + 122} ${base}`,                   // T
    ].join(' ');
    const d = `M20 ${base} ${beat(40)} ${beat(240)} L460 ${base}`;
    let grid = '';
    for (let x = 0; x <= 480; x += 8) grid += `<path d="M${x} 0V260" stroke="${x % 40 ? '#F6D9D2' : '#EDB8AB'}"/>`;
    for (let y = 0; y <= 260; y += 8) grid += `<path d="M0 ${y}H480" stroke="${y % 40 ? '#F6D9D2' : '#EDB8AB'}"/>`;
    const label = (x, y, t) => `<text x="${x}" y="${y}" text-anchor="middle">${t}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 260" width="960" height="520">
<rect width="480" height="260" fill="#FFF8F5"/>
<g stroke-width="1">${grid}</g>
<path d="${d}" fill="none" stroke="#2B2924" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
<g font-family="Georgia, serif" font-size="14" fill="#A9502F" font-weight="bold">
${label(50, base - 16, 'P')}${label(76, base + 26, 'Q')}${label(84, base - 98, 'R')}${label(94, base + 40, 'S')}${label(141, base - 28, 'T')}
</g>
<g font-family="Georgia, serif" font-size="12" fill="#5A564E">
<path d="M40 205H76M40 200v10M76 200v10" stroke="#5A564E"/>${label(58, 223, 'PQ 0,12–0,20 с')}
<path d="M76 238H94M76 233v10M94 233v10" stroke="#5A564E"/>${label(150, 243, 'QRS ≤ 0,10 с')}
${label(107, base - 8, 'ST')}
<text x="16" y="24">Нормальная ЭКГ, II отведение (схема). 25 мм/с: 1 мм = 0,04 с</text>
</g>
</svg>`;
  }

  /* ---------- Хранилище файлов ---------- */

  const FileDB = {
    db: null,
    ok: false,
    mem: new Map(),
    urls: new Map(),

    open() {
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => { if (!done) { done = true; this.ok = ok; resolve(ok); } };
        setTimeout(() => finish(false), 3000);
        let req;
        try { req = indexedDB.open('semestr-files', 1); } catch (e) { finish(false); return; }
        req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
        req.onsuccess = () => { this.db = req.result; finish(true); };
        req.onerror = () => finish(false);
        req.onblocked = () => finish(false);
      });
    },

    tx(mode, fn) {
      return new Promise((resolve, reject) => {
        const t = this.db.transaction('blobs', mode);
        const req = fn(t.objectStore('blobs'));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },

    async put(id, blob) {
      if (!this.ok) { this.mem.set(id, blob); return; }
      try {
        const buf = await blob.arrayBuffer();
        await this.tx('readwrite', (st) => st.put({ buf, type: blob.type || '' }, id));
      } catch (e) {
        this.mem.set(id, blob);
        throw e;
      }
    },

    async get(id) {
      if (this.mem.has(id)) return this.mem.get(id);
      if (!this.ok) return null;
      try {
        const rec = await this.tx('readonly', (st) => st.get(id));
        if (!rec) return null;
        return rec instanceof Blob ? rec : new Blob([rec.buf], { type: rec.type });
      } catch (e) {
        return null;
      }
    },

    async del(id) {
      this.mem.delete(id);
      this.revoke(id);
      if (this.ok) { try { await this.tx('readwrite', (st) => st.delete(id)); } catch (e) { /* уже нет */ } }
    },

    async clear() {
      this.mem.clear();
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls.clear();
      if (this.ok) { try { await this.tx('readwrite', (st) => st.clear()); } catch (e) { /* пусто */ } }
    },

    async url(id) {
      if (this.urls.has(id)) return this.urls.get(id);
      const blob = await this.get(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      this.urls.set(id, u);
      return u;
    },

    revoke(id) {
      const u = this.urls.get(id);
      if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
    },
  };

  App.Store = Store;
  App.FileDB = FileDB;
})(window.App);
