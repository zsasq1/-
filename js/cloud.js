/* Семестр — постоянное хранение данных.
   На сайте расписание, дела, заметки и файлы хранятся в закрытом репозитории пользователя
   на GitHub: одинаковы на всех устройствах, вход на новом — по QR-коду. Через Claude — в
   аккаунте Claude. В «Семестре для Mac» маленький сервер хранит всё в папке на диске.
   Пока ничего не подключено, данные живут только в этом браузере. */
(function (App) {
  'use strict';

  const { U, Store, UI, FileDB } = App;

  const META_KEY = 'semestr.sync';
  const WRAP = 'SEMESTR-FILE-1';
  // Эти форматы хранилище файлов принимает как есть. Остальные (Word, PowerPoint, Excel…)
  // кладём внутрь текстового файла в base64 — так хранилище советует хранить другие форматы
  const NATIVE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm'];
  const MAX_ASSET = 20 * 1024 * 1024;
  const MAX_DOC = 250000; // документ в хранилище — не больше 256 КБ

  const LISTS = ['subjects', 'classes', 'reminders', 'files', 'notifications'];
  const MAPS = ['topicNotes', 'fired', 'settings', 'profile'];

  /* ---------- Сравнение и слияние версий ---------- */

  // JSON с отсортированными ключами: хранилище может вернуть поля в другом порядке
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  // Служебные поля версии в сравнении содержимого не участвуют
  const body = (s) => stable(Object.assign({}, s, { savedAt: 0, writer: 0, ver: 0, parent: 0, lineage: 0 }));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const bytes = (s) => new Blob([s]).size;

  // Сколько в данных добавленного самим человеком — не примера и не загруженного расписания
  function own(st) {
    if (!st) return 0;
    const mine = (list) => (list || []).filter((x) => !x.sample).length;
    return mine(st.reminders) + mine(st.files) + Object.keys(st.topicNotes || {}).length
      + (st.classes || []).filter((c) => !c.sample && (c.source !== 'kgmu' || c.edited)).length
      + (st.profile && st.profile.name ? 1 : 0);
  }

  // Значение, изменённое только с одной стороны, берём оттуда; изменённое с обеих — у более свежей
  function pick3(b, m, t, mineWins) {
    const sm = stable(m);
    const st = stable(t);
    if (sm === st) return m;
    const sb = stable(b);
    if (sm === sb) return t;
    if (st === sb) return m;
    return mineWins ? m : t;
  }

  // Удалённое на одном устройстве и не тронутое на другом — удаляется; новое с любой стороны остаётся
  function mergeById(base, mine, theirs, mineWins) {
    const by = (list) => new Map((list || []).map((x) => [x.id, x]));
    const B = by(base);
    const M = by(mine);
    const T = by(theirs);
    const out = [];
    const seen = new Set();
    (theirs || []).concat(mine || []).forEach((x) => {
      if (seen.has(x.id)) return;
      seen.add(x.id);
      const b = B.get(x.id);
      const m = M.get(x.id);
      const t = T.get(x.id);
      if (m && t) out.push(pick3(b, m, t, mineWins));
      else if (m) { if (!b || stable(b) !== stable(m)) out.push(m); } else if (!b || stable(b) !== stable(t)) out.push(t);
    });
    return out;
  }

  function mergeMap(base, mine, theirs, mineWins) {
    const out = {};
    const b0 = base || {};
    const m0 = mine || {};
    const t0 = theirs || {};
    new Set(Object.keys(t0).concat(Object.keys(m0))).forEach((k) => {
      const b = b0[k];
      const m = m0[k];
      const t = t0[k];
      if (m !== undefined && t !== undefined) out[k] = pick3(b, m, t, mineWins);
      else if (m !== undefined) { if (b === undefined || stable(b) !== stable(m)) out[k] = m; } else if (b === undefined || stable(b) !== stable(t)) out[k] = t;
    });
    return out;
  }

  // Все упомянутые предметы на месте, одинаковые названия слиты в один, лишние убраны
  function fixSubjects(st, sources) {
    const all = new Map();
    sources.concat([st]).forEach((s) => (s.subjects || []).forEach((x) => all.set(x.id, x)));
    const refs = [].concat(st.classes, st.reminders, st.files).map((x) => x.subjectId).filter(Boolean);
    refs.forEach((id) => {
      if (!st.subjects.some((s) => s.id === id) && all.has(id)) st.subjects.push(all.get(id));
    });
    const first = new Map();
    const remap = {};
    st.subjects.forEach((s) => {
      const key = s.name.toLowerCase();
      if (first.has(key)) remap[s.id] = first.get(key).id;
      else first.set(key, s);
    });
    [].concat(st.classes, st.reminders, st.files).forEach((x) => { if (remap[x.subjectId]) x.subjectId = remap[x.subjectId]; });
    const used = new Set([].concat(st.classes, st.reminders, st.files).map((x) => x.subjectId));
    st.subjects = Array.from(first.values()).filter((s) => used.has(s.id));
  }

  function sortLists(st) {
    st.files.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    st.notifications.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  // Изменения и здесь, и на другом устройстве с момента последней синхронизации
  function merge3(base, mine, theirs) {
    const mineWins = (mine.savedAt || 0) > (theirs.savedAt || 0);
    const out = {};
    new Set(Object.keys(theirs).concat(Object.keys(mine))).forEach((k) => {
      if (LISTS.includes(k)) out[k] = mergeById(base[k], mine[k], theirs[k], mineWins);
      else if (MAPS.includes(k)) out[k] = mergeMap(base[k], mine[k], theirs[k], mineWins);
      else out[k] = pick3(base[k], mine[k], theirs[k], mineWins);
    });
    LISTS.forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    fixSubjects(out, [mine, theirs]);
    sortLists(out);
    delete out.writer;
    out.savedAt = Date.now();
    return out;
  }

  // Первая встреча устройства с аккаунтом, и там и тут есть своё: основа — аккаунт,
  // к ней добавляем дела, файлы, свои пары и заметки этого устройства
  function mergeFirst(local, remote) {
    const out = clone(remote);
    LISTS.forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    out.topicNotes = out.topicNotes || {};
    const add = (key, keep) => {
      const have = new Set(out[key].map((x) => x.id));
      (local[key] || []).filter((x) => keep(x) && !have.has(x.id)).forEach((x) => out[key].push(x));
    };
    add('reminders', (x) => !x.sample);
    add('files', (x) => !x.sample);
    add('classes', (x) => !x.sample && x.source !== 'kgmu');
    Object.keys(local.topicNotes || {}).forEach((k) => { if (!out.topicNotes[k]) out.topicNotes[k] = local.topicNotes[k]; });
    if (out.profile && !out.profile.name && local.profile && local.profile.name) out.profile.name = local.profile.name;
    fixSubjects(out, [local, remote]);
    sortLists(out);
    delete out.writer;
    out.savedAt = Date.now();
    return out;
  }

  /* ---------- Файлы ---------- */

  function wrap(blob, type) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result);
        resolve(new Blob([`${WRAP}\n${type}\n`, s.slice(s.indexOf(',') + 1)], { type: 'text/plain' }));
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function unwrap(blob) {
    const head = await blob.slice(0, WRAP.length + 1).text();
    if (head !== `${WRAP}\n`) return blob;
    const text = await blob.text();
    const a = text.indexOf('\n');
    const b = text.indexOf('\n', a + 1);
    const bin = atob(text.slice(b + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: text.slice(a + 1, b) });
  }

  // Временный сбой хранилища — одна повторная попытка
  async function retry(fn) {
    try {
      return await fn();
    } catch (e) {
      if (!e || (e.code !== 'unavailable' && e.code !== 'store_unavailable')) throw e;
      await U.sleep(600 + Math.random() * 900);
      return fn();
    }
  }

  function loadMeta(key) {
    try {
      const m = JSON.parse(U.ls.get(key || META_KEY) || 'null');
      return m && typeof m === 'object' ? m : {};
    } catch (e) {
      return {};
    }
  }

  /* ---------- Где хранить ---------- */

  // Через Claude — хранилище аккаунта
  async function claudeStore() {
    const use = (name) => Promise.resolve().then(() => window.claude.use(name)).catch(() => null);
    const [db, user, assets] = await Promise.all([use('db'), use('user'), use('assets')]);
    const uid = user ? await user.id() : null;
    if (!db || !uid) return null;
    return {
      kind: 'claude',
      ref: db.doc(`data/users/${uid}/state`),
      maxDoc: MAX_DOC,
      files: assets && {
        direct: false,
        async upload(blob) {
          const type = String(blob.type || '').split(';')[0].trim().toLowerCase();
          const native = NATIVE.includes(type);
          const data = native ? blob : await wrap(blob, type || 'application/octet-stream');
          if (data.size > MAX_ASSET) throw { code: 'too_large', message: 'too_large' };
          const res = await assets.upload(data, { type: native ? type : 'text/plain' });
          return res.id;
        },
        remove: (id) => assets.delete(id),
        url: (id) => `/_blob/${id}`,
      },
    };
  }

  // «Семестр для Mac»: сервер на этом компьютере (server.py) хранит всё в папке на диске
  function diskStore() {
    const call = async (path, opts) => {
      let res;
      try {
        res = await fetch(`api/${path}`, Object.assign({ cache: 'no-store' }, opts));
      } catch (e) {
        throw { code: 'unavailable', message: 'Семестр на Mac не запущен' };
      }
      if (res.status >= 500) throw { code: 'unavailable', message: `ошибка ${res.status}` };
      if (res.status >= 400 && res.status !== 404) throw { code: 'invalid_argument', message: `ошибка ${res.status}` };
      return res;
    };
    const snap = (data) => ({ exists: !!data, data: () => data || undefined, metadata: { fromCache: false, hasPendingWrites: false } });
    return {
      kind: 'disk',
      dir: window.SEMESTR_DISK.dir || '',
      maxDoc: Infinity,
      ref: {
        async get() {
          const res = await call('state');
          return snap(res.status === 404 ? null : await res.json());
        },
        async set(p) {
          await call('state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        },
        // Семестр могли изменить в другой вкладке — проверяем каждые пару секунд
        onSnapshot(next) {
          let tag = '';
          let dead = false;
          const poll = async () => {
            if (dead) return;
            try {
              const res = await call('state', { headers: tag ? { 'If-None-Match': tag } : {} });
              if (res.status === 200) {
                tag = res.headers.get('ETag') || '';
                next(snap(await res.json()));
              }
            } catch (e) { /* сервер выключен — проверим позже */ }
            setTimeout(poll, document.hidden ? 15000 : 2500);
          };
          poll();
          return () => { dead = true; };
        },
      },
      files: {
        direct: true,
        async upload(blob, f) {
          await call(`files/${encodeURIComponent(f.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': blob.type || f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) },
            body: blob,
          });
          return f.id;
        },
        remove: (id) => call(`files/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        url: (id) => `api/files/${encodeURIComponent(id)}`,
      },
      reveal: (id) => call(`reveal${id ? `?id=${encodeURIComponent(id)}` : ''}`, { method: 'POST' }),
    };
  }

  /* ---------- Сайт: закрытый репозиторий на GitHub ---------- */

  const GH_KEY = 'semestr.github';
  const GH_FILE_MAX = 50 * 1024 * 1024;
  const GH_POLL = 20000;

  function ghConfig() {
    try {
      const c = JSON.parse(U.ls.get(GH_KEY) || 'null');
      return c && c.token && c.owner && c.repo ? c : null;
    } catch (e) {
      return null;
    }
  }

  const textToB64 = (str) => {
    const arr = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64ToText = (b64) => {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(arr);
  };
  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const b64url = (str) => textToB64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = (s) => b64ToText(s.replace(/-/g, '+').replace(/_/g, '/'));
  const encPath = (path) => path.split('/').map(encodeURIComponent).join('/');

  function ghApi(cfg) {
    const root = cfg.api || window.SEMESTR_GH_API || 'https://api.github.com';
    return async (path, opts = {}) => {
      const headers = Object.assign({ Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' }, opts.headers || {});
      let res;
      try {
        res = await fetch(root + path, Object.assign({}, opts, { headers, cache: 'no-store' }));
      } catch (e) {
        throw { code: 'unavailable', message: 'нет связи с GitHub' };
      }
      if (res.status === 401) throw { code: 'auth', message: 'ключ доступа не подходит или истёк' };
      if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') throw { code: 'unavailable', message: 'GitHub просит немного подождать' };
      if (res.status === 409) throw { code: 'conflict', message: 'данные только что изменились на другом устройстве' };
      if (res.status >= 500) throw { code: 'unavailable', message: `GitHub ответил ${res.status}` };
      return res;
    };
  }

  // Имя файла в хранилище: id, чтобы не путались одинаковые, и само название — чтобы было понятно на GitHub
  const ghFileName = (name) => String(name || 'файл').replace(/[\x00-\x1f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'файл';

  function githubStore(cfg) {
    const call = ghApi(cfg);
    const dir = `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/`;
    const STATE = 'semestr.json';
    let sha = null; // версия semestr.json, от которой записываем следующую
    const snap = (data) => ({ exists: !!data, data: () => data || undefined, metadata: { fromCache: false, hasPendingWrites: false } });
    const read = async (res) => {
      const j = await res.json();
      if (j.content && j.encoding === 'base64') return { sha: j.sha, data: JSON.parse(b64ToText(j.content)) };
      // Больше 1 МБ GitHub отдаёт только «как есть»
      const raw = await call(dir + STATE, { headers: { Accept: 'application/vnd.github.raw' } });
      return { sha: j.sha, data: await raw.json() };
    };
    const bad = (res) => ({ code: res.status === 404 ? 'gone' : 'invalid_argument', message: res.status === 404 ? 'хранилище не найдено' : `GitHub ответил ${res.status}` });
    return {
      kind: 'github',
      cfg,
      maxDoc: Infinity,
      ref: {
        async get() {
          const res = await call(dir + STATE);
          if (res.status === 404) {
            sha = null;
            return snap(null);
          }
          if (!res.ok) throw bad(res);
          const r = await read(res);
          sha = r.sha;
          return snap(r.data);
        },
        async set(p) {
          const body = { message: 'Семестр: сохранение', content: textToB64(JSON.stringify(p)) };
          if (sha) body.sha = sha;
          const res = await call(dir + STATE, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (res.status === 422) throw { code: 'conflict', message: 'данные только что изменились на другом устройстве' };
          if (!res.ok) throw bad(res);
          sha = (await res.json()).content.sha;
        },
        // Изменения с других устройств: проверяем раз в 20 секунд и сразу, когда вкладку снова открыли
        onSnapshot(next) {
          let tag = '';
          let dead = false;
          let timer = null;
          const poll = async () => {
            clearTimeout(timer);
            if (dead) return;
            try {
              const res = await call(dir + STATE, { headers: tag ? { 'If-None-Match': tag } : {} });
              if (res.status === 200) {
                tag = res.headers.get('ETag') || '';
                next(snap((await read(res)).data));
              }
            } catch (e) { /* нет связи — проверим позже */ }
            if (!dead) timer = setTimeout(poll, document.hidden ? 120000 : (window.SEMESTR_GH_POLL || GH_POLL));
          };
          document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
          poll();
          return () => {
            dead = true;
            clearTimeout(timer);
          };
        },
      },
      files: {
        direct: false,
        maxText: '50 МБ',
        async upload(blob, f) {
          if (blob.size > GH_FILE_MAX) throw { code: 'too_large', message: 'too_large' };
          const path = `files/${f.id}-${ghFileName(f.name)}`;
          const res = await call(dir + encPath(path), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Семестр: файл «${f.name}»`, content: await blobToB64(blob) }),
          });
          if (res.status === 422) {
            const exists = await call(dir + encPath(path));
            if (exists.ok) return path; // уже загружен раньше
            throw { code: 'too_large', message: 'too_large' };
          }
          if (res.status === 413) throw { code: 'too_large', message: 'too_large' };
          if (!res.ok) throw { code: 'upstream_error', message: `GitHub ответил ${res.status}` };
          return path;
        },
        async remove(path) {
          const res = await call(dir + encPath(path));
          if (!res.ok) return;
          const { sha: fileSha } = await res.json();
          await call(dir + encPath(path), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Семестр: файл удалён', sha: fileSha }),
          });
        },
        async fetch(path) {
          const res = await call(dir + encPath(path), { headers: { Accept: 'application/vnd.github.raw' } });
          return res.ok ? res.blob() : null;
        },
      },
    };
  }

  // Ссылка для другого устройства: адрес сайта и ключ после «#» — на сервер он не уходит
  function pairLink(cfg) {
    return `${location.origin}${location.pathname}#connect=${b64url(JSON.stringify({ o: cfg.owner, r: cfg.repo, t: cfg.token }))}`;
  }

  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/qrcode.min.js'; // своя копия: код рисуется и без интернета
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('no qrcode')));
      s.onerror = () => reject(new Error('load failed'));
      document.head.appendChild(s);
    });
  }

  /* ---------- Синхронизация ---------- */

  const Cloud = {
    status: 'off', // off | connecting | on | error
    error: '',
    store: null,
    session: U.uid(),
    meta: loadMeta(),
    ref: null,
    pushTimer: null,
    pushing: false,
    again: false,
    pending: null,
    connected: false,
    watching: false,
    adoptedOnBoot: false,
    warned: false,
    fetching: new Map(),
    uploadingAll: false,
    filesReady: Promise.resolve(),

    available() {
      return U.inPreview() || !!window.SEMESTR_DISK || !!ghConfig();
    },

    // 'claude' — аккаунт, 'disk' — папка на Mac, 'github' — хранилище сайта, 'browser' — только этот браузер
    kind() {
      if (this.store) return this.store.kind;
      if (window.SEMESTR_DISK) return 'disk';
      if (U.inPreview()) return 'claude';
      return ghConfig() ? 'github' : 'browser';
    },

    // Открыт как сайт (а не в Claude, не на Mac и не из файла) — можно подключить хранилище на GitHub
    siteMode() {
      return /^https?:$/.test(location.protocol) && !U.inPreview() && !window.SEMESTR_DISK;
    },

    on() {
      return this.status === 'on' || this.status === 'error';
    },

    // Файлы лежат на диске и открываются по ссылке, без копии в браузере
    direct() {
      return !!(this.store && this.store.files && this.store.files.direct && this.on());
    },

    async init(filesReady) {
      if (!this.available() || this.status !== 'off') return false;
      if (filesReady) this.filesReady = filesReady;
      this.status = 'connecting';
      this.renderStatus();
      const gh = ghConfig();
      if (window.SEMESTR_DISK) this.store = diskStore();
      else if (U.inPreview()) this.store = await claudeStore();
      else if (gh) this.store = githubStore(gh);
      if (!this.store) {
        this.status = 'off';
        this.renderStatus();
        return false;
      }
      // У каждого хранилища своя история версий
      this.metaKey = { claude: META_KEY, disk: `${META_KEY}:disk`, github: gh ? `${META_KEY}:gh:${gh.owner}/${gh.repo}` : META_KEY }[this.store.kind];
      this.meta = loadMeta(this.metaKey);
      this.ref = this.store.ref;
      window.addEventListener('pagehide', () => this.flush());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
      setInterval(() => this.applyPending(), 2000);
      // Хранилище было недоступно (например, сервер на Mac не запущен) — пробуем снова
      setInterval(() => {
        if (this.status !== 'error' || this.pushing) return;
        if (this.connected) this.push();
        else this.connect();
      }, 15000);
      return this.connect();
    },

    async connect() {
      if (this.pushing) return false;
      this.pushing = true;
      try {
        const snap = await retry(() => this.ref.get());
        this.status = 'on';
        const remote = snap.exists ? clone(snap.data()) : null;
        if (!remote || this.absorb(remote, true)) await this.write();
        this.connected = true;
      } catch (e) {
        this.fail(e);
      } finally {
        this.pushing = false;
        this.renderStatus();
      }
      this.started();
      return this.connected;
    },

    // После первой удачной связи с хранилищем: следим за изменениями и досылаем файлы
    started() {
      if (!this.connected || this.watching) return;
      this.watching = true;
      this.watch();
      this.uploadMissing();
    },

    localChanged() {
      const base = this.meta.base;
      if (!base || this.pushTimer) return true;
      // Большой файл расписания мог не поместиться в аккаунт — его отсутствие там не считается отличием
      const st = base.kgmuOmitted ? Object.assign({}, Store.state, { kgmuCustom: null, kgmuOmitted: true }) : Store.state;
      return body(st) !== body(base);
    },

    // Общий предок версии из хранилища и того, что знает это устройство. Каждая версия
    // помнит цепочку предков: если в ней есть наша последняя версия — там уже учтены наши изменения
    ancestorFor(remote) {
      const base = this.meta.base;
      const line = remote.lineage || [];
      if (line.includes(base.ver)) return base;
      const hist = this.meta.hist || {};
      for (const v of line) if (hist[v]) return hist[v];
      return null;
    },

    // Принимает версию из хранилища; true — после этого нужно записать результат обратно
    absorb(remote, boot) {
      const base = this.meta.base;
      const changed = this.localChanged();
      if (base && remote.ver === base.ver) return changed;
      if (!base) {
        // Первая встреча устройства с хранилищем
        if (!own(Store.state)) {
          this.adopt(remote, remote, boot);
          return false;
        }
        if (own(remote)) this.adopt(mergeFirst(clone(Store.state), remote), remote, boot);
        else this.setBase(remote);
        return true;
      }
      const anc = this.ancestorFor(remote);
      if (anc === base && !changed) {
        this.adopt(remote, remote, boot);
        return false;
      }
      this.adopt(anc ? merge3(anc, clone(Store.state), remote) : mergeFirst(clone(Store.state), remote), remote, boot);
      return true;
    },

    // Новые данные становятся текущими; от версии `from` отсчитываются следующие изменения
    adopt(data, from, boot) {
      const keepKgmu = Store.state.kgmuCustom;
      const next = Store.normalize(clone(data));
      if (data.kgmuOmitted) next.kgmuCustom = keepKgmu; // слишком большой файл расписания живёт на своём устройстве
      ['writer', 'kgmuOmitted', 'ver', 'parent', 'lineage'].forEach((k) => delete next[k]);
      Store.state = next;
      Store.save({ fromCloud: true });
      this.setBase(from);
      if (App.KGMU) App.KGMU._parsed = null;
      if (boot) this.adoptedOnBoot = true;
      if (App.booted) {
        App.applyTheme();
        App.renderSidebar();
        App.renderView(false);
        App.Notify.updateBadges();
      }
    },

    setBase(payload) {
      const p = clone(payload);
      this.meta.base = p;
      const hist = Object.assign({}, this.meta.hist || {}, { [p.ver]: p });
      const keys = Object.keys(hist);
      keys.slice(0, Math.max(0, keys.length - 6)).forEach((k) => delete hist[k]);
      this.meta.hist = hist;
      U.ls.set(this.metaKey || META_KEY, JSON.stringify(this.meta));
    },

    payloadOf(st) {
      const base = this.meta.base;
      const max = this.store ? this.store.maxDoc : MAX_DOC;
      const p = clone(st);
      ['kgmuOmitted', 'ver', 'parent', 'lineage'].forEach((k) => delete p[k]);
      p.writer = this.session;
      p.ver = U.uid();
      p.parent = base ? base.ver : null;
      p.lineage = base ? [base.ver].concat(base.lineage || []).slice(0, 24) : [];
      if (!p.savedAt) p.savedAt = Date.now();
      if (max !== Infinity && bytes(JSON.stringify(p)) > max && p.kgmuCustom) {
        p.kgmuCustom = null;
        p.kgmuOmitted = true;
      }
      if (max !== Infinity && bytes(JSON.stringify(p)) > max) p.notifications = p.notifications.slice(0, 20);
      return p;
    },

    // Store.save сообщает об изменениях — сохраняем через секунду тишины
    changed() {
      if (!this.on()) return;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => this.push(), 1000);
      this.renderStatus();
    },

    flush() {
      if (!this.pushTimer) return;
      clearTimeout(this.pushTimer);
      this.push();
    },

    async write() {
      const p = this.payloadOf(Store.state);
      await retry(() => this.ref.set(p));
      this.setBase(p);
      this.status = 'on';
      this.error = '';
      const kind = this.kind();
      const flag = { disk: 'diskWelcomed', github: 'ghWelcomed' }[kind] || 'cloudWelcomed';
      if (!Store.state.settings[flag]) {
        Store.state.settings[flag] = true;
        Store.save();
        UI.toast({
          disk: 'Всё, что вы добавляете, сохраняется на этом Mac — в папке «Данные» рядом с Семестром',
          github: 'Готово: всё сохраняется в вашем хранилище — открывайте Семестр на любом телефоне и компьютере',
        }[kind] || 'Теперь всё, что вы добавляете, сохраняется в вашем аккаунте Claude — на телефоне и на компьютере', { timeout: 7000 });
      }
    },

    // Перед записью смотрим, не сохранило ли что-то другое устройство, — тогда сначала объединяем
    async push() {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      if (!this.ref) return;
      if (this.pushing) {
        this.again = true;
        return;
      }
      this.pushing = true;
      this.renderStatus();
      try {
        const snap = await retry(() => this.ref.get());
        if (snap.exists) this.absorb(clone(snap.data()));
        await this.write();
        this.connected = true;
        this.conflicts = 0;
      } catch (e) {
        // Другое устройство записало между нашим чтением и записью — читаем заново и объединяем
        if (e && e.code === 'conflict' && (this.conflicts || 0) < 3) {
          this.conflicts = (this.conflicts || 0) + 1;
          this.again = true;
        } else {
          this.fail(e);
        }
      } finally {
        this.pushing = false;
        this.renderStatus();
      }
      this.started();
      if (this.again) {
        this.again = false;
        this.push();
      }
    },

    // Изменения с другого устройства или вкладки приходят сами
    watch() {
      this.ref.onSnapshot((snap) => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const d = snap.data();
        if (d.writer === this.session || (this.meta.base && d.ver === this.meta.base.ver)) return;
        this.pending = clone(d);
        this.applyPending();
      }, (e) => {
        if (e && e.code === 'unavailable') setTimeout(() => this.watch(), 3000);
        else this.fail(e);
      });
    },

    // Пока открыто окно или идёт сохранение, чужие изменения ждут
    applyPending() {
      const remote = this.pending;
      if (!remote || this.pushing || UI.hasModal()) return;
      this.pending = null;
      if (this.absorb(remote)) this.push();
    },

    fail(e) {
      const code = e && e.code;
      this.error = (e && e.message) || String(e);
      this.status = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code) ? 'off' : 'error';
      if (code === 'quota_exceeded') {
        UI.toast('В хранилище аккаунта не осталось места — изменения пока только на этом устройстве', { timeout: 8000 });
      } else if (code === 'auth' || code === 'gone') {
        if (!this.authWarned) {
          this.authWarned = true;
          UI.toast(code === 'auth'
            ? 'Ключ доступа к хранилищу не подходит или истёк — подключите хранилище заново в настройках'
            : 'Хранилище на GitHub не найдено — подключите его заново в настройках', {
            timeout: 10000,
            action: { label: 'Подключить', fn: () => this.openConnect() },
          });
        }
      } else if (this.status === 'error' && !this.warned) {
        this.warned = true;
        UI.toast({
          disk: 'Семестр на Mac сейчас не запущен — изменения попадут на диск, как только вы его запустите',
          github: 'Нет связи с хранилищем — изменения пока на этом устройстве и сохранятся, как только появится интернет',
        }[this.kind()] || 'Не получилось сохранить в аккаунте — изменения пока только на этом устройстве. Попробуем ещё раз', { timeout: 8000 });
      }
      this.renderStatus();
    },

    /* ---------- Файлы ---------- */

    async uploadMissing() {
      if (!this.store || !this.store.files || this.uploadingAll) return;
      this.uploadingAll = true;
      try {
        await this.filesReady;
        for (const f of Store.state.files.slice()) {
          if (f.assetId || f.cloudSkip) continue;
          const blob = await FileDB.getLocal(f.id);
          if (blob) await this.uploadFile(f.id, blob);
        }
      } finally {
        this.uploadingAll = false;
      }
    },

    // true — файл в хранилище
    async uploadFile(id, blob) {
      const files = this.store && this.store.files;
      const f0 = Store.state.files.find((x) => x.id === id);
      if (!files || !f0) return false;
      const mark = (patch) => {
        const f = Store.state.files.find((x) => x.id === id);
        if (f) {
          Object.assign(f, patch);
          Store.save();
        }
        return f;
      };
      try {
        const assetId = await files.upload(blob, f0);
        if (!mark({ assetId })) {
          this.deleteAsset(assetId); // файл успели удалить
          return true;
        }
        // На диске файл уже есть — копия в браузере только занимает место
        if (files.direct) await FileDB.del(id);
        return true;
      } catch (e) {
        const code = e && e.code;
        if (code === 'too_large') {
          const f = mark({ cloudSkip: 'big' });
          if (f) UI.toast(`«${f.name}» больше ${files.maxText || '20 МБ'} — он останется только на этом устройстве`, { timeout: 7000 });
        } else if (code === 'unsupported_type' || code === 'invalid_request') {
          mark({ cloudSkip: 'type' });
        } else if (code === 'quota_or_state' && !this.quotaWarned) {
          this.quotaWarned = true;
          UI.toast('Место для файлов в аккаунте закончилось — новые файлы остаются только на этом устройстве', { timeout: 8000 });
        }
        // остальное — временное, попробуем при следующем запуске
        return false;
      }
    },

    directUrl(f) {
      return this.direct() && f && f.assetId ? this.store.files.url(f.assetId) : null;
    },

    // Файла нет в этом браузере — скачиваем из хранилища при первом открытии
    fetchFile(f) {
      if (!f || !f.assetId || !this.store || !this.store.files) return Promise.resolve(null);
      if (!this.fetching.has(f.id)) {
        const job = (async () => {
          try {
            let blob;
            if (this.store.files.fetch) {
              blob = await this.store.files.fetch(f.assetId);
              if (!blob) return null;
            } else {
              const res = await fetch(this.store.files.url(f.assetId));
              if (!res.ok) return null;
              blob = await unwrap(await res.blob());
            }
            return blob.type ? blob : new Blob([blob], { type: f.type || '' });
          } catch (e) {
            return null;
          } finally {
            setTimeout(() => this.fetching.delete(f.id), 0);
          }
        })();
        this.fetching.set(f.id, job);
      }
      return this.fetching.get(f.id);
    },

    deleteAsset(assetId) {
      const files = this.store && this.store.files;
      if (files && assetId) Promise.resolve().then(() => files.remove(assetId)).catch(() => {});
    },

    reveal(id) {
      if (!this.store || !this.store.reveal) return;
      this.store.reveal(id).catch(() => UI.toast('Не получилось открыть Finder — запущен ли Семестр на Mac?'));
    },

    /* ---------- Подключение хранилища на GitHub ---------- */

    openConnect() {
      const owner = (ghConfig() || {}).owner || '';
      const repoUrl = 'https://github.com/new?name=semestr-data&visibility=private&description=' + encodeURIComponent('Данные Семестра');
      const tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('Семестр')
        + '&description=' + encodeURIComponent('Доступ сайта Семестр к хранилищу данных')
        + '&contents=write' + (owner ? `&target_name=${encodeURIComponent(owner)}` : '');
      UI.modal({
        title: 'Все устройства',
        focus: 'none',
        body: `
          <div class="gh">
            <p class="modal-text">Расписание, дела, заметки и файлы будут храниться в вашем закрытом репозитории на GitHub — их видите только вы. Настроить нужно один раз; другие телефоны и компьютеры потом подключаются по QR-коду.</p>
            <ol class="howto gh-steps">
              <li><b>Создайте закрытое хранилище.</b> <a class="link" href="${U.esc(repoUrl)}" target="_blank" rel="noopener">Открыть GitHub</a> и нажать «Create repository», ничего не меняя. Нет аккаунта на GitHub — там же можно зарегистрироваться.</li>
              <li><b>Создайте ключ доступа.</b> <a class="link" href="${U.esc(tokenUrl)}" target="_blank" rel="noopener">Открыть GitHub</a>. В «Repository access» выберите «Only select repositories» → <b>semestr-data</b>. В «Permissions» у «Contents» поставьте «Read and write». В «Expiration» — «No expiration» или самый долгий срок. Нажмите «Generate token» и скопируйте ключ.</li>
              <li><b>Вставьте ключ сюда.</b></li>
            </ol>
            <div class="field">
              <label for="gh-token">Ключ доступа</label>
              <input id="gh-token" class="input" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">
            </div>
            <details class="more">
              <summary>Хранилище называется иначе</summary>
              <div class="more-body"><input id="gh-repo" class="input" value="${U.esc((ghConfig() || {}).repo || 'semestr-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Название хранилища"></div>
            </details>
            <p class="form-error" id="gh-err" hidden></p>
          </div>`,
        foot: `
          <button class="btn btn-ghost" type="button" data-close>Отмена</button>
          <button class="btn btn-primary" type="button" data-go>Подключить</button>`,
        onMount: (el, api) => {
          const err = el.querySelector('#gh-err');
          const btn = el.querySelector('[data-go]');
          btn.addEventListener('click', async () => {
            const token = el.querySelector('#gh-token').value.trim();
            const repo = el.querySelector('#gh-repo').value.trim() || 'semestr-data';
            err.hidden = true;
            if (!token) {
              err.textContent = 'Вставьте ключ доступа из шага 2.';
              err.hidden = false;
              return;
            }
            btn.disabled = true;
            btn.textContent = 'Проверяю…';
            try {
              const cfg = await this.checkGithub(token, repo);
              api.close();
              await this.useGithub(cfg);
            } catch (e) {
              err.textContent = e.message || String(e);
              err.hidden = false;
              btn.disabled = false;
              btn.textContent = 'Подключить';
            }
          });
        },
      });
    },

    // Проверяем ключ: чей он, есть ли хранилище, закрыто ли оно и можно ли в него писать
    async checkGithub(token, repo) {
      const call = ghApi({ token });
      let res;
      try {
        res = await call('/user');
      } catch (e) {
        throw new Error(e.code === 'auth' ? 'Ключ не подошёл. Скопируйте его целиком ещё раз (начинается с github_pat_).' : 'Нет связи с GitHub. Проверьте интернет.');
      }
      if (!res.ok) throw new Error('Ключ не подошёл. Скопируйте его целиком ещё раз.');
      const owner = (await res.json()).login;
      res = await call(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      if (res.status === 404) throw new Error(`Не нашёл хранилище «${repo}» у ${owner}. Создайте его (шаг 1) и дайте ключу доступ к нему (шаг 2).`);
      if (!res.ok) throw new Error(`GitHub ответил ${res.status}. Попробуйте ещё раз.`);
      const info = await res.json();
      if (!info.private) throw new Error(`Хранилище «${repo}» открыто для всех — ваши данные увидят другие. Сделайте его закрытым (Settings → Danger Zone → Change visibility → Private).`);
      if (info.permissions && !info.permissions.push) throw new Error('У ключа нет права записи: в «Permissions» у «Contents» нужно «Read and write».');
      return { owner, repo, token };
    },

    async useGithub(cfg) {
      U.ls.set(GH_KEY, JSON.stringify(cfg));
      this.authWarned = false;
      if (this.store && this.store.kind === 'github') {
        // Сменили ключ или хранилище — проще начать с чистого листа
        location.reload();
        return;
      }
      UI.toast('Подключаю хранилище…');
      const ok = await this.init();
      if (ok) {
        if (App.route === 'settings') App.renderView(false);
        else App.refresh();
      }
    },

    // Открыли ссылку с ключом (QR-код с другого устройства)
    takeConnectLink() {
      const m = location.hash.match(/^#connect=([A-Za-z0-9_-]+)/);
      if (!m) return;
      try {
        const c = JSON.parse(fromB64url(m[1]));
        if (c && c.o && c.r && c.t) this.pendingLink = { owner: c.o, repo: c.r, token: c.t };
      } catch (e) { /* испорченная ссылка */ }
      history.replaceState(null, '', `${location.pathname}${location.search}#home`);
    },

    async confirmLink() {
      const cfg = this.pendingLink;
      this.pendingLink = null;
      if (!cfg) return;
      const cur = ghConfig();
      if (cur && cur.owner === cfg.owner && cur.repo === cfg.repo && cur.token === cfg.token) return;
      const ok = await UI.confirm({
        title: 'Подключить хранилище?',
        text: `Семестр на этом устройстве будет хранить данные в репозитории ${cfg.owner}/${cfg.repo} на GitHub и покажет всё, что там уже есть. Подключайте, только если это ваше хранилище.`,
        ok: 'Подключить',
        danger: false,
      });
      if (!ok) return;
      try {
        await this.checkGithub(cfg.token, cfg.repo);
      } catch (e) {
        UI.toast(e.message, { timeout: 9000 });
        return;
      }
      await this.useGithub(cfg);
    },

    openPair() {
      const cfg = ghConfig();
      if (!cfg) return;
      const link = pairLink(cfg);
      UI.modal({
        title: 'Открыть на другом устройстве',
        size: 'small',
        focus: 'none',
        body: `
          <div class="pair">
            <p class="modal-text">Наведите камеру телефона на код — Семестр откроется сразу с вашими данными. Можно и отправить ссылку себе, например в «Избранное» Telegram.</p>
            <div class="qr" id="pair-qr"><span class="shimmer">Готовлю код…</span></div>
            <p class="field-hint">В коде и ссылке — ключ к вашему хранилищу. Не показывайте их другим. Если всё же показали — удалите ключ на GitHub (Settings → Developer settings → Personal access tokens) и подключите новый.</p>
          </div>`,
        foot: `
          <button class="btn" type="button" data-copy>${U.ico('link')} Скопировать ссылку</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" type="button" data-close>Готово</button>`,
        onMount: (el) => {
          loadQR().then((qrcode) => {
            const qr = qrcode(0, 'L');
            qr.addData(link);
            qr.make();
            el.querySelector('#pair-qr').innerHTML = qr.createSvgTag(4, 2);
          }).catch(() => {
            el.querySelector('#pair-qr').innerHTML = '<p class="field-hint">Не получилось нарисовать код без интернета — скопируйте ссылку.</p>';
          });
          el.querySelector('[data-copy]').addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(link);
              UI.toast('Ссылка скопирована — откройте её на другом устройстве');
            } catch (e) {
              window.prompt('Скопируйте ссылку:', link);
            }
          });
        },
      });
    },

    async disconnect() {
      const ok = await UI.confirm({
        title: 'Отключить на этом устройстве?',
        text: 'Семестр перестанет сохранять изменения в хранилище с этого устройства. Всё, что уже сохранено, останется в хранилище и на других устройствах.',
        ok: 'Отключить',
      });
      if (!ok) return;
      U.ls.del(GH_KEY);
      location.reload();
    },

    /* ---------- Тексты для настроек и подтверждений ---------- */

    // Откуда удаляется: «из аккаунта…», «с этого Mac…», «из этого браузера»
    whereText() {
      if (!this.on()) return 'из этого браузера';
      return {
        disk: 'с этого Mac (файлы попадут в папку «Корзина»)',
        github: 'из вашего хранилища и со всех устройств',
      }[this.kind()] || 'из аккаунта и со всех устройств';
    },

    label() {
      return { claude: 'Сохранение в аккаунте', disk: 'Хранение на Mac', github: 'Все устройства', browser: this.siteMode() ? 'Все устройства' : 'Где хранятся данные' }[this.kind()];
    },

    pill() {
      if (this.kind() === 'browser') {
        return this.siteMode() ? `<button class="btn btn-primary" data-action="sync-connect">${U.ico('link')} Подключить</button>` : '';
      }
      let pill;
      if (this.status === 'connecting') pill = '<span class="pill">Подключаемся…</span>';
      else if (this.status === 'error') pill = '<span class="pill cloud-err">Не сохранено</span>';
      else if (this.status === 'off') pill = '<span class="pill">Недоступно</span>';
      else if (this.pushing || this.pushTimer) pill = '<span class="pill">Сохраняем…</span>';
      else pill = `<span class="pill accent">${U.ico('check')} Сохранено</span>`;
      if (this.kind() === 'disk') pill += `<button class="btn" data-action="disk-reveal">${U.ico('folder')} Открыть в Finder</button>`;
      if (this.kind() === 'github') {
        pill += `<button class="btn" data-action="sync-pair">${U.ico('phone')} Другое устройство</button>
          <button class="btn btn-ghost" data-action="sync-disconnect">Отключить</button>`;
      }
      return pill;
    },

    describe() {
      const kind = this.kind();
      if (kind === 'browser') {
        if (this.siteMode()) return 'Сейчас данные хранятся только в этом браузере. Подключите хранилище — и Семестр с вашими делами, заметками и файлами откроется на любом телефоне и компьютере.';
        return 'Данные хранятся в этом браузере на этом устройстве. Не очищайте данные сайта и иногда скачивайте резервную копию. Чтобы хранить всё на Mac без ограничений, запускайте «Семестр для Mac».';
      }
      if (kind === 'github') {
        const repo = this.store ? `${this.store.cfg.owner}/${this.store.cfg.repo}` : '';
        if (this.status === 'error') return `Последнее изменение не сохранилось в хранилище (${U.esc(this.error)}). Оно ждёт на этом устройстве — попробуем ещё раз.`;
        return `Всё хранится в вашем закрытом репозитории «${U.esc(repo)}» на GitHub и одинаково на всех устройствах, где вы подключили Семестр. Файлы — до 50 МБ каждый. Другие устройства подключаются по QR-коду.`;
      }
      if (kind === 'disk') {
        if (this.status === 'error') return 'Семестр на Mac сейчас не запущен — откройте «Семестр.command». До этого изменения хранятся в браузере и попадут на диск, как только он заработает.';
        const dir = this.store && this.store.dir ? `«${U.esc(this.store.dir)}»` : '«Данные» рядом с Семестром';
        return `Всё хранится на этом Mac в папке ${dir}: расписание, дела, заметки и файлы любого размера, разложенные по предметам. Каждый день сохраняется копия данных в папке «Копии».`;
      }
      if (this.status === 'off') return 'Хранилище аккаунта сейчас недоступно — данные сохраняются только в этом браузере.';
      if (this.status === 'error') return `Последнее изменение не сохранилось в аккаунте (${U.esc(this.error)}). Попробуем ещё раз.`;
      return 'Расписание, дела, заметки и файлы хранятся в вашем аккаунте Claude: не пропадут после перезагрузки и одинаковы на телефоне и компьютере.';
    },

    renderStatus() {
      const el = document.getElementById('cloud-status');
      if (el) el.innerHTML = this.pill();
      const desc = document.getElementById('cloud-desc');
      if (desc) desc.innerHTML = this.describe();
    },
  };

  Object.assign(App.actions, {
    'disk-reveal': (el) => Cloud.reveal(el.dataset.id),
    'sync-connect': () => Cloud.openConnect(),
    'sync-pair': () => Cloud.openPair(),
    'sync-disconnect': () => Cloud.disconnect(),
    'sync-hide': () => {
      U.ls.set('semestr.hideSync', '1');
      App.refresh();
    },
  });

  // Для проверок
  Cloud._merge3 = merge3;
  Cloud._mergeFirst = mergeFirst;
  Cloud._pairLink = () => { const c = ghConfig(); return c && pairLink(c); };

  App.Cloud = Cloud;
})(window.App);
