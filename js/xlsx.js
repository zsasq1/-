/* Семестр — чтение .xlsx без сторонних библиотек: текст ячеек первого листа и объединения.
   Раньше для этого с cdnjs подгружалась SheetJS 0.18.5 — без проверки целостности и с известными
   уязвимостями (CVE-2023-30533, CVE-2024-22363). Файл .xlsx — это zip с XML внутри: распаковывает
   сам браузер (DecompressionStream), XML разбирает DOMParser — он не выполняет скрипты
   и не загружает внешние сущности. Файл может прийти откуда угодно (их пересылают в чатах),
   поэтому всё ограничено: размер, число тегов, таблица и длина ячейки. Настоящая таблица
   КГМУ — около 40 КБ, 45 × 11 ячеек, самая длинная ячейка — около 600 символов. */
(function (App) {
  'use strict';

  const MAX_FILE = 20 * 1024 * 1024;  // сам .xlsx
  const MAX_PART = 4 * 1024 * 1024;   // одна распакованная часть
  const MAX_TOTAL = 12 * 1024 * 1024; // все распакованные части вместе
  const MAX_TAGS = 200000;            // тегов в одной части: DOMParser на миллионах тегов занимает гигабайты
  const MAX_ROWS = 1000;              // ячейки дальше просто не читаем
  const MAX_COLS = 100;
  const MAX_CELL = 2000;              // символов в ячейке, остальное отрезаем
  const MAX_TEXT = 500000;            // символов во всех ячейках вместе; больше — файл не читаем
  const MAX_FORMATS = 200;            // разных форматов чисел; остальные — «Общий»
  const MAX_MERGES = 5000;            // объединений; в настоящих таблицах их меньше сотни

  const tooBig = () => Object.assign(new Error('слишком большая таблица'), { tooBig: true });

  // Обрезка по MAX_CELL, не разрывая эмодзи и другие символы из двух половинок
  const clip = (s) => {
    if (s.length <= MAX_CELL) return s;
    const hi = s.charCodeAt(MAX_CELL - 1);
    return s.slice(0, hi >= 0xd800 && hi <= 0xdbff ? MAX_CELL - 1 : MAX_CELL);
  };

  /* ---------- Zip ---------- */

  function openZip(buffer) {
    if (buffer.byteLength > MAX_FILE) throw tooBig();
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (p) => dv.getUint16(p, true);
    const u32 = (p) => dv.getUint32(p, true);
    // Конец каталога ищем с конца файла: за ним может идти комментарий до 64 КБ
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 0xffff); p--) {
      if (u32(p) === 0x06054b50) { end = p; break; }
    }
    if (end < 0) throw new Error('это не .xlsx');
    const count = u16(end + 10);
    let p = u32(end + 16);
    const names = new TextDecoder();
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || u32(p) !== 0x02014b50) throw new Error('файл повреждён');
      const nameLen = u16(p + 28);
      // Некоторые программы пишут пути через «\»
      const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
      entries.set(name.replace(/^\/+/, '').toLowerCase(), {
        method: u16(p + 10), size: u32(p + 20), local: u32(p + 42),
      });
      p += 46 + nameLen + u16(p + 30) + u16(p + 32);
    }

    let spent = 0;
    const take = (n) => {
      spent += n;
      if (n > MAX_PART || spent > MAX_TOTAL) throw tooBig();
    };

    return {
      async text(path) {
        const e = entries.get(path.toLowerCase());
        if (!e) return null;
        if (e.size === 0xffffffff || e.local + 30 > bytes.length || u32(e.local) !== 0x04034b50) throw new Error('файл повреждён');
        const start = e.local + 30 + u16(e.local + 26) + u16(e.local + 28);
        const raw = bytes.subarray(start, start + e.size);
        if (raw.length !== e.size) throw new Error('файл повреждён');
        if (e.method === 0) {
          take(raw.length);
          return new TextDecoder().decode(raw);
        }
        if (e.method !== 8) throw new Error('неизвестное сжатие');
        // Сжатое подаём по 4 КБ, дожидаясь каждой порции: целиком (Blob.stream() отдаёт до 2 МБ разом)
        // браузер распаковал бы «бомбу» в гигабайты ещё до первой проверки размера
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        let stop = false;
        (async () => {
          for (let i = 0; i < raw.length && !stop; i += 4096) await writer.write(raw.subarray(i, i + 4096));
          if (!stop) await writer.close();
        })().catch(() => {});
        const parts = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PART) {
            stop = true;
            reader.cancel().catch(() => {});
            throw tooBig();
          }
          parts.push(value);
        }
        take(size);
        return new Blob(parts).text();
      },
    };
  }

  /* ---------- XML ---------- */

  function parseXml(text) {
    let tags = 0;
    for (let i = text.indexOf('<'); i >= 0; i = text.indexOf('<', i + 1)) {
      if (++tags > MAX_TAGS) throw tooBig();
    }
    const parse = (s) => {
      const doc = new DOMParser().parseFromString(s, 'application/xml');
      return doc.getElementsByTagName('parsererror').length ? null : doc;
    };
    // Не все программы пишут правильный XML: управляющие символы и &nbsp; Excel терпит, DOMParser — нет
    const doc = parse(text) || parse(text.replace(/[\x0B\x0C]/g, ' ').replace(/[\x00-\x08\x0E-\x1F]/g, '').replace(/&nbsp;/g, '&#160;'));
    if (!doc) throw new Error('файл повреждён');
    return doc;
  }

  const kids = (el, name) => Array.from(el.children).filter((x) => x.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;

  // Excel пишет управляющие символы как _x000D_; _x005F_ — сам знак «_»
  const decodeX = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

  // Текст строки (<si> или <is>): <t> прямо внутри или в кусках с оформлением <r>; подсказки
  // произношения (<rPh>) не берём. Строго по структуре, а не все <t> внутри: вложенные друг
  // в друга <t> размножали бы текст на каждом уровне
  function richText(el) {
    const own = (x) => decodeX(kids(x, 't').map((t) => t.textContent).join(''));
    let s = own(el);
    kids(el, 'r').forEach((r) => { if (s.length <= MAX_CELL) s += own(r); });
    return clip(s);
  }

  // Путь части файла по ссылке из .rels: относительно папки той части, где ссылка
  function resolve(from, target) {
    const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
    target.replace(/^\/+/, '').split('/').forEach((seg) => {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    });
    return parts.join('/');
  }

  async function rels(zip, part) {
    const i = part.lastIndexOf('/');
    const xml = await zip.text(`${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`);
    if (!xml) return [];
    return kids(parseXml(xml).documentElement, 'Relationship').map((r) => ({
      id: r.getAttribute('Id'),
      type: r.getAttribute('Type') || '',
      target: r.getAttribute('TargetMode') === 'External' ? null : resolve(part, r.getAttribute('Target') || ''),
    }));
  }

  /* ---------- Числа и даты ---------- */

  // Встроенные форматы Excel; даты — как в русском Excel
  const BUILTIN = new Map(Object.entries({
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
    14: 'dd.mm.yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
    20: 'h:mm', 21: 'h:mm:ss', 22: 'dd.mm.yyyy h:mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 49: '@',
  }));
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const WEEKDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const pad = (n) => String(n).padStart(2, '0');

  function general(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    const s = String(Number(v.toPrecision(11)));
    return s.replace(/e\+?/, 'E+').replace('E+-', 'E-');
  }

  // Формат даты разбираем один раз: что из «m» — месяц, а что — минуты, решаем двумя линейными проходами
  function compileDate(code) {
    const toks = code.match(/"[^"]*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+|[\s\S]/gi) || [];
    const kind = toks.map((t) => (t.startsWith('"') || t.startsWith('\\') ? '' : t.toLowerCase()));
    const ampm = kind.some((k) => k === 'am/pm' || k === 'a/p');
    const isTok = (k) => /^[a-z]/.test(k);
    const minute = new Array(toks.length).fill(false);
    // «m» после часов или перед секундами — минуты, иначе месяц
    let prev = '';
    kind.forEach((k, i) => {
      if (k === 'm' || k === 'mm') minute[i] = /^h+$/.test(prev);
      if (isTok(k)) prev = k;
    });
    let next = '';
    for (let i = kind.length - 1; i >= 0; i--) {
      const k = kind[i];
      if ((k === 'm' || k === 'mm') && /^s+$/.test(next)) minute[i] = true;
      if (isTok(k)) next = k;
    }
    return (v, d1904) => {
      // 1900-й год в Excel считается високосным: до 1 марта 1900 отсчёт на день сдвинут
      const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, v < 61 ? 31 : 30);
      const d = new Date(base + Math.round(v * 86400) * 1000);
      if (Number.isNaN(d.getTime())) return general(v);
      return toks.map((t, i) => {
        const k = kind[i];
        if (t.startsWith('"')) return t.slice(1, -1);
        if (t.startsWith('\\')) return t.slice(1);
        switch (k) {
          case 'm': return String(minute[i] ? d.getUTCMinutes() : d.getUTCMonth() + 1);
          case 'mm': return pad(minute[i] ? d.getUTCMinutes() : d.getUTCMonth() + 1);
          case 'h': case 'hh': {
            const h = ampm ? d.getUTCHours() % 12 || 12 : d.getUTCHours();
            return k === 'hh' ? pad(h) : String(h);
          }
          case 's': return String(d.getUTCSeconds());
          case 'ss': return pad(d.getUTCSeconds());
          case 'yyyy': return String(d.getUTCFullYear());
          case 'yy': return pad(d.getUTCFullYear() % 100);
          case 'mmmm': return MONTH[d.getUTCMonth()];
          case 'mmm': return MON[d.getUTCMonth()];
          case 'dddd': return WEEKDAY[d.getUTCDay()];
          case 'ddd': return WD[d.getUTCDay()];
          case 'dd': return pad(d.getUTCDate());
          case 'd': return String(d.getUTCDate());
          case 'am/pm': return d.getUTCHours() < 12 ? 'AM' : 'PM';
          case 'a/p': return d.getUTCHours() < 12 ? 'A' : 'P';
          default: return /^\.0+$/.test(t) ? '' : t;
        }
      }).join('');
    };
  }

  function compile(code) {
    // Excel не даёт форматов длиннее 255 символов; всё, что длиннее, — порча или ловушка
    if (typeof code !== 'string' || code.length > 255) return general;
    // Только первая секция формата; цвета и локали в [скобках] не нужны, [h] читаем как h
    const sec = code.split(';')[0].replace(/\[(h+|m+|s+)\]/gi, '$1').replace(/\[[^\]]*\]/g, '');
    const bare = sec.replace(/"[^"]*"|\\./g, '');
    if (!bare.trim() || /^general$/i.test(bare.trim()) || bare.trim() === '@') return general;
    if (/[dmyhs]/i.test(bare)) return compileDate(sec);
    const pct = bare.includes('%');
    const dec = Math.min(30, (bare.match(/\.([0#]+)/) || ['', ''])[1].length); // в Excel не больше 30 знаков
    const group = /[#0],[#0]/.test(bare);
    return (v) => {
      const x = pct ? v * 100 : v;
      let s = Math.abs(x).toFixed(dec);
      if (group) {
        const [i, f] = s.split('.');
        s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
      }
      return (x < 0 && Number(s.replace(/,/g, '')) !== 0 ? '-' : '') + s + (pct ? '%' : '');
    };
  }

  /* ---------- Ячейки ---------- */

  function cellRef(ref) {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref || '');
    if (!m) return null;
    let c = 0;
    for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: Number(m[2]) - 1, c: c - 1 };
  }

  async function read(buffer) {
    if (!App.Xlsx.supported()) throw new Error('браузер не умеет распаковывать .xlsx');
    const zip = openZip(buffer);

    const root = (await rels(zip, '')).find((r) => /\/officeDocument$/.test(r.type));
    const wbPath = root && root.target ? root.target : 'xl/workbook.xml';
    const wbXml = await zip.text(wbPath);
    if (!wbXml) throw new Error('в файле нет книги Excel');
    const wb = parseXml(wbXml).documentElement;
    const wbRels = await rels(zip, wbPath);
    const pr = kid(wb, 'workbookPr');
    const d1904 = !!pr && /^(1|true)$/i.test(pr.getAttribute('date1904') || '');

    // Первый лист в порядке книги, даже скрытый — как раньше брала SheetJS (SheetNames[0])
    // r:id ищем по известным пространствам имён, а не перебором атрибутов: перебор в Blink квадратичен
    const sheets = kid(wb, 'sheets');
    const first = sheets && kid(sheets, 'sheet');
    const rid = first && (first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      || first.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id'));
    const sheetRel = rid && wbRels.find((r) => r.id === rid);
    const sheetPath = sheetRel && sheetRel.target ? sheetRel.target : 'xl/worksheets/sheet1.xml';
    const sheetXml = await zip.text(sheetPath);
    if (!sheetXml) throw new Error('в книге нет листов');

    const part = (type, fallback) => {
      const r = wbRels.find((x) => x.type.endsWith(`/${type}`));
      return r && r.target ? r.target : fallback;
    };
    const sstXml = await zip.text(part('sharedStrings', 'xl/sharedStrings.xml'));
    const strings = sstXml ? kids(parseXml(sstXml).documentElement, 'si').map(richText) : [];

    // Форматы чисел ячеек: только <numFmts> верхнего уровня — у условного форматирования (<dxf>) свои
    const formats = [];
    const stXml = await zip.text(part('styles', 'xl/styles.xml'));
    if (stXml) {
      const st = parseXml(stXml).documentElement;
      const custom = new Map();
      const nf = kid(st, 'numFmts');
      if (nf) kids(nf, 'numFmt').forEach((f) => custom.set(f.getAttribute('numFmtId'), f.getAttribute('formatCode') || ''));
      const xfs = kid(st, 'cellXfs');
      if (xfs) kids(xfs, 'xf').forEach((xf) => {
        const id = xf.getAttribute('numFmtId') || '0';
        formats.push(custom.has(id) ? custom.get(id) : (BUILTIN.get(id) || 'General'));
      });
    }
    const compiled = new Map();
    const formatOf = (s) => {
      const code = formats[s] || 'General';
      if (!compiled.has(code)) compiled.set(code, compiled.size < MAX_FORMATS ? compile(code) : general);
      return compiled.get(code);
    };

    const sheet = parseXml(sheetXml).documentElement;
    const cells = new Map();
    let maxR = -1;
    let maxC = -1;
    let chars = 0;

    // Строки и ячейки — только на своих местах (<sheetData>/<row>/<c>): вложенные друг в друга строки
    // заставляли бы каждую ячейку перечитывать всё под собой
    const data = kid(sheet, 'sheetData');
    let r = -1;
    (data ? kids(data, 'row') : []).forEach((row) => {
      const rr = Number(row.getAttribute('r'));
      r = rr > 0 ? rr - 1 : r + 1;
      let c = -1;
      kids(row, 'c').forEach((el) => {
        // Адрес ячейки главнее номера строки: так читают Excel и openpyxl
        const ref = cellRef(el.getAttribute('r'));
        if (ref) { r = ref.r; c = ref.c; } else c += 1;
        if (r >= MAX_ROWS || c >= MAX_COLS) return;
        const v = kid(el, 'v');
        const raw = v ? v.textContent : null;
        const t = el.getAttribute('t') || 'n';
        // Число, логическое значение или код ошибки длиннее 300 символов — порча, такую ячейку пропускаем
        const short = raw != null && raw.length <= 300;
        let text;
        if (t === 's') text = short ? strings[parseInt(raw, 10)] : null;
        else if (t === 'inlineStr') { const is = kid(el, 'is'); text = is ? richText(is) : null; }
        else if (t === 'str') text = raw == null ? null : clip(decodeX(raw));
        else if (t === 'b') text = short ? (raw.trim() === '1' || /^true$/i.test(raw.trim()) ? 'TRUE' : 'FALSE') : null;
        else if (t === 'e' || t === 'd') text = short ? raw : null;
        else if (short && raw.trim() !== '' && Number.isFinite(Number(raw))) {
          text = formatOf(Number(el.getAttribute('s')) || 0)(Number(raw), d1904);
        } else text = null;
        // Пустые и из одних пробелов не храним: иначе случайный пробел далеко внизу раздувает таблицу
        if (typeof text !== 'string' || !text.trim()) return;
        text = clip(text);
        chars += text.length;
        if (chars > MAX_TEXT) throw tooBig();
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
        cells.set(`${r}:${c}`, text);
      });
    });

    // Объединения таблицу не растягивают: объединённую на всю ширину строку (A1:XFD1) обрезаем по границе.
    // Берём только те, что начинаются с ячейки с текстом (другие расписанию не нужны), без повторов
    const mc = kid(sheet, 'mergeCells');
    const anchors = new Set();
    const merges = (mc ? kids(mc, 'mergeCell') : []).map((m) => {
      const [a, b] = (m.getAttribute('ref') || '').split(':');
      const s = cellRef(a);
      const e = cellRef(b || a);
      if (!s || !e) return null;
      const r1 = Math.min(s.r, e.r);
      const c1 = Math.min(s.c, e.c);
      const key = `${r1}:${c1}`;
      if (!cells.has(key) || anchors.has(key) || anchors.size >= MAX_MERGES) return null;
      anchors.add(key);
      return [r1, c1, Math.min(Math.max(s.r, e.r), MAX_ROWS - 1), Math.min(Math.max(s.c, e.c), MAX_COLS - 1)];
    }).filter(Boolean);

    const grid = [];
    for (let i = 0; i <= maxR; i++) {
      const row = [];
      for (let j = 0; j <= maxC; j++) row.push(cells.get(`${i}:${j}`) || '');
      grid.push(row);
    }
    return { grid, merges };
  }

  App.Xlsx = {
    MAX_FILE,
    supported() {
      if (typeof DOMParser !== 'function' || typeof DecompressionStream !== 'function') return false;
      // 'deflate-raw' появился позже 'gzip': в Chrome 80–102 его нет
      try { new DecompressionStream('deflate-raw'); return true; } catch (e) { return false; }
    },
    read,
  };
})(window.App);
