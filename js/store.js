/* Семестр — состояние приложения (localStorage) и хранилище файлов (IndexedDB) */
(function (App) {
  'use strict';

  const U = App.U;
  const KEY = 'semestr.v1';

  // Оттенки предметов: подобраны так, чтобы различаться и в светлой, и в тёмной теме
  const HUES = [18, 210, 145, 40, 285, 350, 178, 95, 248, 8];

  // Типичное расписание звонков: пары по 90 минут
  const PAIRS = [
    ['08:30', '10:00'], ['10:10', '11:40'], ['11:50', '13:20'], ['13:50', '15:20'],
    ['15:30', '17:00'], ['17:10', '18:40'], ['18:50', '20:20'],
  ];

  const CLASS_TYPES = { lecture: 'Лекция', practice: 'Практика', lab: 'Лаба', seminar: 'Семинар' };
  const CLASS_TYPES_FULL = { lecture: 'Лекция', practice: 'Практика', lab: 'Лабораторная', seminar: 'Семинар' };

  function semesterStartFor(now) {
    const y = now.getFullYear();
    const m = now.getMonth();
    if (m >= 7) return `${y}-09-01`;      // август–декабрь: осенний семестр
    if (m === 0) return `${y - 1}-09-01`;  // январь: сессия осеннего
    return `${y}-02-09`;                   // весенний семестр
  }

  const Store = {
    KEY, HUES, PAIRS, CLASS_TYPES, CLASS_TYPES_FULL,
    state: null,
    storageOk: true,
    firstRun: false,
    seedBlobs: null,

    defaults() {
      return {
        version: 1,
        profile: { name: '' },
        settings: {
          theme: 'system',
          classLead: 15,
          systemNotify: false,
          semesterStart: semesterStartFor(new Date()),
          showSunday: false,
          sidebarCollapsed: false,
          filesView: 'grid',
        },
        subjects: [],
        classes: [],
        reminders: [],
        files: [],
        notifications: [],
        fired: {},
        sampleBanner: false,
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
    },

    normalize(data) {
      const def = this.defaults();
      const st = Object.assign(def, data);
      st.settings = Object.assign(this.defaults().settings, data.settings || {});
      st.profile = Object.assign({ name: '' }, data.profile || {});
      ['subjects', 'classes', 'reminders', 'files', 'notifications'].forEach((k) => {
        if (!Array.isArray(st[k])) st[k] = [];
      });
      if (!st.fired || typeof st.fired !== 'object') st.fired = {};
      return st;
    },

    save() {
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

    subjectByName(name, hue) {
      const n = String(name || '').trim().replace(/\s+/g, ' ');
      if (!n) return null;
      let s = this.state.subjects.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (!s) {
        s = { id: U.uid(), name: n, hue: hue != null ? hue : this.nextHue() };
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

    /* ---------- Пример данных для первого запуска ---------- */

    seed() {
      const st = this.state;
      const now = new Date();
      const sub = {};
      const add = (key, name, hue) => { sub[key] = this.subjectByName(name, hue); };
      add('calc', 'Математический анализ', 18);
      add('alg', 'Линейная алгебра', 210);
      add('py', 'Программирование на Python', 145);
      add('phys', 'Физика', 40);
      add('hist', 'История России', 285);
      add('eng', 'Английский язык', 350);
      add('pe', 'Физическая культура', 178);

      const P = PAIRS;
      const cls = (subject, type, day, pair, room, teacher, weeks = 'all') => ({
        id: U.uid(), subjectId: sub[subject].id, type, day,
        start: P[pair - 1][0], end: P[pair - 1][1], room, teacher, weeks, sample: true,
      });

      st.classes = [
        cls('calc', 'lecture', 1, 1, '305', 'Смирнов А. В.'),
        cls('alg', 'practice', 1, 2, '214', 'Котова Е. Н.'),
        cls('eng', 'practice', 1, 3, '118', 'Джонсон М.'),
        cls('phys', 'lecture', 2, 2, 'Большая физ.', 'Орлов П. С.'),
        cls('py', 'lab', 2, 3, '412', 'Белов Д. А.', 'odd'),
        cls('phys', 'practice', 2, 3, '221', 'Орлов П. С.', 'even'),
        cls('hist', 'seminar', 2, 4, '507', 'Лебедева Т. И.'),
        cls('alg', 'lecture', 3, 1, '305', 'Котова Е. Н.'),
        cls('calc', 'practice', 3, 2, '214', 'Смирнов А. В.'),
        cls('pe', 'practice', 3, 4, 'Спортзал', ''),
        cls('py', 'lecture', 4, 2, '301', 'Белов Д. А.'),
        cls('py', 'lab', 4, 3, '412', 'Белов Д. А.'),
        cls('eng', 'practice', 4, 4, '118', 'Джонсон М.'),
        cls('phys', 'lab', 5, 1, '120', 'Орлов П. С.', 'even'),
        cls('calc', 'practice', 5, 2, '214', 'Смирнов А. В.'),
        cls('hist', 'lecture', 5, 3, '305', 'Лебедева Т. И.'),
        cls('calc', 'seminar', 6, 2, '305', 'Смирнов А. В.'),
        cls('pe', 'practice', 6, 3, 'Спортзал', ''),
      ];

      const at = (days, t) => U.atTime(U.addDays(now, days), t).toISOString();
      const rem = (title, subject, due, kind, lead, done = false) => ({
        id: U.uid(), title, subjectId: subject ? sub[subject].id : null, due, kind, lead, done,
        createdAt: now.toISOString(), doneAt: done ? now.toISOString() : null, sample: true,
      });
      st.reminders = [
        rem('Сдать лабораторную №2 — списки и словари', 'py', at(2, '23:59'), 'deadline', 1440),
        rem('Прочитать Фихтенгольца, т. 1, гл. 2 — пределы', 'calc', at(1, '19:00'), 'reminder', 15),
        rem('Коллоквиум: пределы и непрерывность', 'calc', at(5, '10:10'), 'deadline', 1440),
        rem('Эссе «Реформы Петра I», 5000 знаков', 'hist', at(9, '23:59'), 'deadline', 1440),
        rem('Купить тетрадь для лабораторных', null, null, 'reminder', 0, true),
      ];

      const files = [
        { name: 'Вопросы к коллоквиуму — пределы.txt', type: 'text/plain', subject: 'calc', body: SAMPLE_QUESTIONS },
        { name: 'Шпаргалка по Python.md', type: 'text/markdown', subject: 'py', body: SAMPLE_PYTHON },
        { name: 'График sin x — к лабораторной.svg', type: 'image/svg+xml', subject: 'phys', body: sineSvg() },
      ];
      this.seedBlobs = [];
      st.files = files.map((f, i) => {
        const blob = new Blob([f.body], { type: f.type });
        const id = U.uid() + i;
        this.seedBlobs.push({ id, blob });
        return {
          id, name: f.name, size: blob.size, type: f.type, subjectId: sub[f.subject].id,
          addedAt: new Date(now.getTime() - (i + 1) * 3.6e6).toISOString(), sample: true,
        };
      });

      st.notifications = [
        {
          id: U.uid(), kind: 'system', read: false, at: new Date(now.getTime() - 6e4).toISOString(),
          title: 'Добро пожаловать в Семестр',
          body: 'Здесь появятся напоминания о парах и дедлайнах. Системные уведомления включаются в настройках.',
          route: 'settings',
        },
        {
          id: U.uid(), kind: 'file', read: true, at: new Date(now.getTime() - 36e5).toISOString(),
          title: 'Добавлено 3 файла', body: 'Примеры конспектов лежат в разделе «Файлы».', route: 'files',
        },
      ];
      st.sampleBanner = true;
    },
  };

  const SAMPLE_QUESTIONS = `Коллоквиум по математическому анализу
Тема: пределы и непрерывность

1. Определение предела последовательности (на языке ε–N).
2. Единственность предела. Ограниченность сходящейся последовательности.
3. Предельный переход в неравенствах. Лемма о двух милиционерах.
4. Монотонные последовательности. Теорема Вейерштрасса.
5. Число e как предел последовательности (1 + 1/n)^n.
6. Первый и второй замечательные пределы.
7. Непрерывность функции в точке. Классификация точек разрыва.
8. Теоремы Больцано — Коши и Вейерштрасса для функций на отрезке.

Консультация: суббота, 2-я пара, ауд. 305.
`;

  const SAMPLE_PYTHON = `# Шпаргалка по Python

## Списки
- lst.append(x) — добавить в конец
- lst[::-1] — развернуть
- [x * 2 for x in lst if x > 0] — генератор списка

## Словари
- d.get(key, default) — значение или запасной вариант
- for k, v in d.items(): ... — обход пар

## Файлы
with open("data.txt", encoding="utf-8") as f:
    lines = f.read().splitlines()

## Лаба №2
Сдать до конца недели: функции для частотного словаря
и сортировки слов по количеству вхождений.
`;

  function sineSvg() {
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const x = 30 + i * 3;
      const y = 110 - Math.sin((i / 120) * Math.PI * 2) * 70;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    let grid = '';
    for (let i = 0; i <= 8; i++) grid += `<path d="M${30 + i * 45} 30V190"/>`;
    for (let j = 0; j <= 4; j++) grid += `<path d="M30 ${40 + j * 35}H390"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 220" width="840" height="440">
<rect width="420" height="220" fill="#FBFAF6"/>
<g stroke="#ECE8DD" stroke-width="1">${grid}</g>
<path d="M30 110H396M30 24V196" stroke="#8A857B" stroke-width="1.2" fill="none"/>
<path d="${d}" fill="none" stroke="#C96442" stroke-width="2.6" stroke-linecap="round"/>
<g font-family="Georgia, serif" font-size="13" fill="#5A564E">
<text x="38" y="28">y = sin x</text>
<text x="202" y="128">π</text><text x="382" y="128">2π</text>
<text x="112" y="128">π/2</text><text x="285" y="128">3π/2</text>
<text x="14" y="44">1</text><text x="8" y="184">−1</text>
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
