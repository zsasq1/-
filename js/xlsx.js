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
  const MAX_PART = 8 * 1024 * 1024;   // одна распакованная часть
  const MAX_TOTAL = 24 * 1024 * 1024; // все распакованные части вместе
  const MAX_TAGS = 200000;            // тегов в одной части: DOMParser на миллионах тегов занимает гигабайты
  const MAX_ROWS = 2000;              // ячейки дальше просто не читаем
  const MAX_COLS = 200;
  const MAX_CELL = 2000;              // символов в ячейке, остальное отрезаем
  const MAX_TEXT = 500000;            // символов во всех ячейках вместе

  const tooBig = () => new Error('слишком большая таблица');

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
        const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const parts = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PART) {
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
    const doc = parse(text) || parse(text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&nbsp;/g, '&#160;'));
    if (!doc) throw new Error('файл повреждён');
    return doc;
  }

  const byName = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
  const kids = (el, name) => Array.from(el.children).filter((x) => x.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;

  // Excel пишет управляющие символы как _x000D_; _x005F_ — сам знак «_»
  const decodeX = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

  // Текст строки с оформлением: все <t>, кроме подсказок произношения (<rPh>)
  function richText(el) {
    return byName(el, 't').filter((t) => {
      for (let p = t.parentElement; p && p !== el; p = p.parentElement) if (p.localName === 'rPh') return false;
      return true;
    }).map((t) => t.textContent).join('');
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
    return byName(parseXml(xml), 'Relationship').map((r) => ({
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

  // Формат даты разбираем один раз: что из «m» — месяц, а что — минуты, решаем за один проход
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
    const dec = (bare.match(/\.([0#]+)/) || ['', ''])[1].length;
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
    const wb = parseXml(wbXml);
    const wbRels = await rels(zip, wbPath);
    const pr = byName(wb, 'workbookPr')[0];
    const d1904 = !!pr && /^(1|true)$/i.test(pr.getAttribute('date1904') || '');

    // Первый лист в порядке книги, даже скрытый — как раньше брала SheetJS (SheetNames[0])
    const first = byName(wb, 'sheet')[0];
    const rid = first && Array.from(first.attributes).find((a) => a.localName === 'id' && a.namespaceURI);
    const sheetRel = rid && wbRels.find((r) => r.id === rid.value);
    const sheetPath = sheetRel && sheetRel.target ? sheetRel.target : 'xl/worksheets/sheet1.xml';
    const sheetXml = await zip.text(sheetPath);
    if (!sheetXml) throw new Error('в книге нет листов');

    const part = (type, fallback) => {
      const r = wbRels.find((x) => x.type.endsWith(`/${type}`));
      return r && r.target ? r.target : fallback;
    };
    const sstXml = await zip.text(part('sharedStrings', 'xl/sharedStrings.xml'));
    const strings = sstXml ? kids(parseXml(sstXml).documentElement, 'si').map((si) => decodeX(richText(si))) : [];

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
      if (!compiled.has(code)) compiled.set(code, compile(code));
      return compiled.get(code);
    };

    const sheet = parseXml(sheetXml);
    const cells = new Map();
    let maxR = -1;
    let maxC = -1;
    let chars = 0;

    let r = -1;
    byName(sheet, 'row').forEach((row) => {
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
        let text;
        if (t === 's') text = raw == null ? null : strings[parseInt(raw, 10)];
        else if (t === 'inlineStr') { const is = kid(el, 'is'); text = is ? decodeX(richText(is)) : null; }
        else if (t === 'str') text = raw == null ? null : decodeX(raw);
        else if (t === 'b') text = raw == null ? null : (raw.trim() === '1' || /^true$/i.test(raw.trim()) ? 'TRUE' : 'FALSE');
        else if (t === 'e' || t === 'd') text = raw;
        else if (raw != null && raw.trim() !== '' && Number.isFinite(Number(raw))) {
          text = formatOf(Number(el.getAttribute('s')) || 0)(Number(raw), d1904);
        } else text = null;
        // Пустые и из одних пробелов не храним: иначе случайный пробел далеко внизу раздувает таблицу
        if (typeof text !== 'string' || !text.trim()) return;
        if (text.length > MAX_CELL) text = text.slice(0, MAX_CELL);
        chars += text.length;
        if (chars > MAX_TEXT) throw tooBig();
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
        cells.set(`${r}:${c}`, text);
      });
    });

    // Объединения таблицу не растягивают: объединённую на всю ширину строку (A1:XFD1) обрезаем по границе
    const merges = byName(sheet, 'mergeCell').map((m) => {
      const [a, b] = (m.getAttribute('ref') || '').split(':');
      const s = cellRef(a);
      const e = cellRef(b || a);
      if (!s || !e) return null;
      const r1 = Math.min(s.r, e.r);
      const c1 = Math.min(s.c, e.c);
      if (r1 < 0 || c1 < 0 || r1 >= MAX_ROWS || c1 >= MAX_COLS) return null;
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
