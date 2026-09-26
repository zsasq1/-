/* Семестр — общие утилиты: даты, форматирование, иконки, разбор сроков */
window.App = window.App || {};
window.App.actions = window.App.actions || {}; // обработчики data-action="…"
window.App.changes = window.App.changes || {}; // обработчики data-change="…"

(function (App) {
  'use strict';

  const U = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.pad = (n) => String(n).padStart(2, '0');
  U.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  U.debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  U.ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* нет доступа */ } },
  };

  /* ---------- Даты ---------- */

  U.ymd = (d) => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  U.hm = (d) => `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  U.toMin = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  U.fromMin = (m) => `${U.pad(Math.floor(m / 60) % 24)}:${U.pad(m % 60)}`;
  U.startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.setMin = (d, min) => { const x = U.startOfDay(d); x.setHours(Math.floor(min / 60), min % 60, 0, 0); return x; };
  U.atTime = (d, t) => U.setMin(d, U.toMin(t));
  U.isoDay = (d) => ((d.getDay() + 6) % 7) + 1; // Пн = 1 … Вс = 7
  U.mondayOf = (d) => U.addDays(U.startOfDay(d), 1 - U.isoDay(d));
  U.sameDay = (a, b) => U.ymd(a) === U.ymd(b);
  U.dayDiff = (a, b) => Math.round((U.startOfDay(b) - U.startOfDay(a)) / 864e5);
  U.parseYmd = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  U.toLocalInput = (d) => `${U.ymd(d)}T${U.hm(d)}`;
  U.fromLocalInput = (s) => {
    if (!s) return null;
    const [date, time] = s.split('T');
    return U.setMin(U.parseYmd(date), U.toMin(time || '00:00'));
  };

  U.MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  U.DAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  U.DAYS_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  U.DAYS_ACC = ['', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];

  U.plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };
  U.count = (n, forms) => `${n} ${U.plural(n, forms)}`;

  U.fmtDate = (d, now = new Date()) => {
    const s = `${d.getDate()} ${U.MONTHS_GEN[d.getMonth()]}`;
    return d.getFullYear() === now.getFullYear() ? s : `${s} ${d.getFullYear()}`;
  };
  U.fmtDayLong = (d) => `${U.DAYS[U.isoDay(d)]}, ${U.fmtDate(d)}`;

  // «сегодня», «завтра», «в пятницу», «3 октября»
  U.dayWord = (d, now = new Date()) => {
    const diff = U.dayDiff(now, d);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff === 2) return 'послезавтра';
    if (diff === -1) return 'вчера';
    if (diff > 2 && diff < 7) return U.DAYS_ACC[U.isoDay(d)];
    return U.fmtDate(d, now);
  };
  U.fmtWhen = (d, now = new Date()) => `${U.dayWord(d, now)} в ${U.hm(d)}`;

  U.fmtSize = (b) => {
    if (!b) return '0 Б';
    if (b < 1024) return `${b} Б`;
    const units = ['КБ', 'МБ', 'ГБ'];
    let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < units.length - 1);
    return `${b.toFixed(b < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
  };

  // «5 мин», «1 ч 20 мин», «2 дня»
  U.relIn = (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
    const d = Math.round(h / 24);
    return U.count(d, ['день', 'дня', 'дней']);
  };

  U.timeAgo = (d, now = new Date()) => {
    const s = (now - d) / 1000;
    if (s < 45) return 'только что';
    if (s < 3600) return `${Math.round(s / 60)} мин назад`;
    const dd = U.dayDiff(d, now);
    if (dd === 0) return `${U.count(Math.floor(s / 3600), ['час', 'часа', 'часов'])} назад`;
    if (dd === 1) return `вчера в ${U.hm(d)}`;
    return `${U.fmtDate(d, now)} в ${U.hm(d)}`;
  };

  U.greeting = (d) => {
    const h = d.getHours();
    if (h >= 5 && h < 12) return 'Доброе утро';
    if (h >= 12 && h < 17) return 'Добрый день';
    if (h >= 17 && h < 23) return 'Добрый вечер';
    return 'Доброй ночи';
  };

  /* ---------- Разбор срока из текста ----------
     «сдать лабу завтра в 18:00», «коллоквиум 12 октября»,
     «эссе до 25.10», «позвонить старосте через 2 часа», «в пятницу в 9 утра» */

  const B = '(?=[\\s,.!?;:]|$)';
  const MONTHS_RE = U.MONTHS_GEN.join('|');
  const WEEKDAYS = {
    'понедельник': 1, 'вторник': 2, 'среду': 3, 'среда': 3, 'четверг': 4,
    'пятницу': 5, 'пятница': 5, 'субботу': 6, 'суббота': 6, 'воскресенье': 7,
    'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
  };

  U.parseWhen = (text, now = new Date()) => {
    let s = ` ${text} `;
    const today = U.startOfDay(now);
    let rel = null;
    let relIsDays = false;
    let day = null;
    let isWeekday = false;
    let time = null;

    const cut = (re, fn) => {
      const m = s.match(re);
      if (!m || fn(m) === false) return false;
      s = s.replace(m[0], ' ');
      return true;
    };

    cut(new RegExp(`\\sчерез\\s+(?:(\\d{1,3})\\s+)?(полчаса|минут[уы]?|мин|час(?:а|ов)?|ч|день|дня|дней|недел[юиь]|нед)${B}`, 'i'), (m) => {
      const n = m[1] ? Number(m[1]) : 1;
      const u = m[2].toLowerCase();
      let ms;
      if (u === 'полчаса') ms = 30 * 6e4;
      else if (u.startsWith('мин')) ms = n * 6e4;
      else if (u.startsWith('ч')) ms = n * 36e5;
      else if (u.startsWith('д')) { ms = n * 864e5; relIsDays = true; }
      else { ms = n * 7 * 864e5; relIsDays = true; }
      rel = new Date(now.getTime() + ms);
    });

    if (!rel) {
      cut(new RegExp(`\\s(?:(?:на|к|до)\\s+)?(сегодня|завтра|послезавтра)${B}`, 'i'), (m) => {
        day = U.addDays(today, { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[m[1].toLowerCase()]);
      });
    }
    if (!rel && !day) {
      const pick = (m) => {
        const wd = WEEKDAYS[m[1].toLowerCase()];
        day = U.addDays(today, (wd - U.isoDay(today) + 7) % 7);
        isWeekday = true;
      };
      cut(new RegExp(`\\s(?:(?:в|во|к|ко|до)\\s+)?(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)${B}`, 'i'), pick)
        || cut(new RegExp(`\\s(?:в|во|к|ко|до)\\s+(пн|вт|ср|чт|пт|сб|вс)${B}`, 'i'), pick);
    }
    if (!rel && !day) {
      cut(new RegExp(`\\s(?:(?:к|до|на)\\s+)?(\\d{1,2})\\s+(${MONTHS_RE})${B}`, 'i'), (m) => {
        const d = new Date(now.getFullYear(), U.MONTHS_GEN.indexOf(m[2].toLowerCase()), Number(m[1]));
        if (d.getDate() !== Number(m[1])) return false;
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        day = d;
      });
    }
    if (!rel && !day) {
      cut(new RegExp(`\\s(?:(?:к|до|на)\\s+)?(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${B}`), (m) => {
        const dd = Number(m[1]);
        const mm = Number(m[2]);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
        let y = m[3] ? Number(m[3]) : now.getFullYear();
        if (y < 100) y += 2000;
        const d = new Date(y, mm - 1, dd);
        if (d.getDate() !== dd) return false;
        if (!m[3] && d < today) d.setFullYear(d.getFullYear() + 1);
        day = d;
      });
    }

    cut(new RegExp(`\\s(?:(?:в|к|до|на)\\s+)?(\\d{1,2}):(\\d{2})${B}`), (m) => {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h > 23 || mi > 59) return false;
      time = h * 60 + mi;
    }) || cut(new RegExp(`\\s(?:в|к|до)\\s+(\\d{1,2})\\s*(утра|дня|вечера|ночи)${B}`, 'i'), (m) => {
      let h = Number(m[1]);
      const p = m[2].toLowerCase();
      if ((p === 'дня' || p === 'вечера') && h < 12) h += 12;
      if (p === 'ночи' && h === 12) h = 0;
      if (h > 23) return false;
      time = h * 60;
    });

    let due = null;
    if (rel) {
      due = relIsDays && time != null ? U.setMin(rel, time) : rel;
    } else if (day) {
      due = U.setMin(day, time != null ? time : 9 * 60);
      if (isWeekday && due < now) due = U.addDays(due, 7);
    } else if (time != null) {
      due = U.setMin(today, time);
      if (due <= now) due = U.addDays(due, 1);
    }
    if (!due) return null;

    const clean = s
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s,.;:!?—-]+$/, '')
      .replace(/\s(в|во|к|до|на)$/i, '')
      .trim();
    return { due, clean };
  };

  /* ---------- Скачивание ---------- */

  // Открыт ли Семестр в предпросмотре claude.ai: там файлы сохраняются через окно подтверждения,
  // и не все форматы разрешены
  U.inPreview = () => !!(window.claude && typeof window.claude.use === 'function');

  // Отдать файл пользователю: 'saved' | 'declined' | 'blocked'
  U.saveFile = async (data, name, type) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    if (U.inPreview()) {
      let dl = null;
      try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (dl) {
        try {
          await dl.save({ filename: name, data: blob });
          return 'saved';
        } catch (e) {
          return e && e.code === 'declined' ? 'declined' : 'blocked';
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  };

  /* ---------- Иконки ---------- */

  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
    calendar: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/>',
    'calendar-plus': '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4M12 12.5v5M9.5 15h5"/>',
    folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.4l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5v7.8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10.2 20a2 2 0 0 0 3.6 0"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    paperclip: '<path d="m20.5 11.5-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.3-8.3a3.6 3.6 0 0 1 5 5l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/>',
    'arrow-up': '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    'chevron-left': '<path d="m14.5 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9.5 18 6-6-6-6"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V4.5M7 9.5l5-5 5 5M5 20h14"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h11.5l-2.2 4 2.2 4H5.5"/>',
    book: '<path d="M12 7v13.5"/><path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h4a3 3 0 0 1 3 3 3 3 0 0 1 3-3h4a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 18h-4a3 3 0 0 0-3 3 3 3 0 0 0-3-3H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>',
    'check-all': '<path d="m2.5 12.5 4.5 4.5L16.5 7.5M12 16.5l.5.5L22 7.5"/>',
  };

  U.ico = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  U.mark = (cls = '') => `<svg class="mark ${cls}" viewBox="0 0 24 24" aria-hidden="true"><circle class="mark-ring" cx="12" cy="12" r="9"/><circle class="mark-core" cx="12" cy="12" r="4.4"/><g class="mark-orbit"><circle cx="21" cy="12" r="2.2"/></g></svg>`;

  App.U = U;
})(window.App);
