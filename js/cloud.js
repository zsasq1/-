/* Семестр — сохранение в аккаунте Claude.
   Когда Семестр открыт через Claude, расписание, дела, заметки и файлы хранятся в аккаунте:
   не пропадают после перезагрузки и одинаковы на телефоне и компьютере. Вне Claude (сайт,
   отдельный файл) всё по-прежнему хранится только в этом браузере. */
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

  function loadMeta() {
    try {
      const m = JSON.parse(U.ls.get(META_KEY) || 'null');
      return m && typeof m === 'object' ? m : {};
    } catch (e) {
      return {};
    }
  }

  /* ---------- Синхронизация ---------- */

  const Cloud = {
    status: 'off', // off | connecting | on | error
    error: '',
    saving: false,
    session: U.uid(),
    meta: loadMeta(),
    ref: null,
    assets: null,
    pushTimer: null,
    pushing: false,
    again: false,
    pending: null,
    adoptedOnBoot: false,
    warned: false,
    fetching: new Map(),
    uploadingAll: false,
    filesReady: Promise.resolve(),

    // Только внутри Claude у страницы есть хранилище аккаунта
    available() {
      return U.inPreview();
    },

    on() {
      return this.status === 'on' || this.status === 'error';
    },

    async init(filesReady) {
      if (!this.available() || this.status !== 'off') return false;
      if (filesReady) this.filesReady = filesReady;
      this.status = 'connecting';
      this.renderStatus();
      const use = (name) => Promise.resolve().then(() => window.claude.use(name)).catch(() => null);
      const [db, user, assets] = await Promise.all([use('db'), use('user'), use('assets')]);
      const uid = user ? await user.id() : null;
      if (!db || !uid) {
        this.status = 'off';
        this.renderStatus();
        return false;
      }
      this.ref = db.doc(`data/users/${uid}/state`);
      this.assets = assets;
      this.pushing = true;
      try {
        const snap = await retry(() => this.ref.get());
        this.status = 'on';
        const remote = snap.exists ? clone(snap.data()) : null;
        if (!remote || this.absorb(remote, true)) await this.write();
      } catch (e) {
        this.fail(e);
        return false;
      } finally {
        this.pushing = false;
        this.renderStatus();
      }
      this.watch();
      this.uploadMissing();
      window.addEventListener('pagehide', () => this.flush());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
      setInterval(() => this.applyPending(), 2000);
      return true;
    },

    localChanged() {
      const base = this.meta.base;
      if (!base || this.pushTimer) return true;
      // Большой файл расписания мог не поместиться в аккаунт — его отсутствие там не считается отличием
      const st = base.kgmuOmitted ? Object.assign({}, Store.state, { kgmuCustom: null, kgmuOmitted: true }) : Store.state;
      return body(st) !== body(base);
    },

    // Общий предок версии из аккаунта и того, что знает это устройство. Каждая версия
    // помнит цепочку предков: если в ней есть наша последняя версия — там уже учтены наши изменения
    ancestorFor(remote) {
      const base = this.meta.base;
      const line = remote.lineage || [];
      if (line.includes(base.ver)) return base;
      const hist = this.meta.hist || {};
      for (const v of line) if (hist[v]) return hist[v];
      return null;
    },

    // Принимает версию из аккаунта; true — после этого нужно записать результат обратно
    absorb(remote, boot) {
      const base = this.meta.base;
      const changed = this.localChanged();
      if (base && remote.ver === base.ver) return changed;
      if (!base) {
        // Первая встреча устройства с аккаунтом
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
      U.ls.set(META_KEY, JSON.stringify(this.meta));
    },

    payloadOf(st) {
      const base = this.meta.base;
      const p = clone(st);
      ['kgmuOmitted', 'ver', 'parent', 'lineage'].forEach((k) => delete p[k]);
      p.writer = this.session;
      p.ver = U.uid();
      p.parent = base ? base.ver : null;
      p.lineage = base ? [base.ver].concat(base.lineage || []).slice(0, 24) : [];
      if (!p.savedAt) p.savedAt = Date.now();
      if (bytes(JSON.stringify(p)) > MAX_DOC && p.kgmuCustom) {
        p.kgmuCustom = null;
        p.kgmuOmitted = true;
      }
      if (bytes(JSON.stringify(p)) > MAX_DOC) p.notifications = p.notifications.slice(0, 20);
      return p;
    },

    // Store.save сообщает об изменениях — сохраняем в аккаунт через секунду тишины
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
      if (!Store.state.settings.cloudWelcomed) {
        Store.state.settings.cloudWelcomed = true;
        Store.save();
        UI.toast('Теперь всё, что вы добавляете, сохраняется в вашем аккаунте Claude — на телефоне и на компьютере', { timeout: 7000 });
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
      } catch (e) {
        this.fail(e);
      } finally {
        this.pushing = false;
        this.renderStatus();
      }
      if (this.again) {
        this.again = false;
        this.push();
      }
    },

    // Изменения с другого устройства приходят сами
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
      } else if (this.status === 'error' && !this.warned) {
        this.warned = true;
        UI.toast('Не получилось сохранить в аккаунте — изменения пока только на этом устройстве. Попробуем снова при следующем изменении', { timeout: 8000 });
      }
      this.renderStatus();
    },

    /* ---------- Файлы в аккаунте ---------- */

    async uploadMissing() {
      if (!this.assets || !this.ref || this.uploadingAll) return;
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

    async uploadFile(id, blob) {
      const mark = (patch) => {
        const f = Store.state.files.find((x) => x.id === id);
        if (f) {
          Object.assign(f, patch);
          Store.save();
        }
        return f;
      };
      const big = () => {
        const f = mark({ cloudSkip: 'big' });
        if (f) UI.toast(`«${f.name}» больше 20 МБ — он останется только на этом устройстве`, { timeout: 7000 });
      };
      try {
        const type = String(blob.type || '').split(';')[0].trim().toLowerCase();
        const native = NATIVE.includes(type);
        const data = native ? blob : await wrap(blob, type || 'application/octet-stream');
        if (data.size > MAX_ASSET) {
          big();
          return;
        }
        const res = await this.assets.upload(data, { type: native ? type : 'text/plain' });
        if (!mark({ assetId: res.id })) this.deleteAsset(res.id); // файл успели удалить
      } catch (e) {
        const code = e && e.code;
        if (code === 'too_large') big();
        else if (code === 'unsupported_type' || code === 'invalid_request') mark({ cloudSkip: 'type' });
        else if (code === 'quota_or_state' && !this.quotaWarned) {
          this.quotaWarned = true;
          UI.toast('Место для файлов в аккаунте закончилось — новые файлы остаются только на этом устройстве', { timeout: 8000 });
        }
        // остальное — временное, попробуем при следующем запуске
      }
    },

    // Файл с другого устройства скачивается из аккаунта при первом открытии
    fetchFile(f) {
      if (!f || !f.assetId || !this.available()) return Promise.resolve(null);
      if (!this.fetching.has(f.id)) {
        const job = (async () => {
          try {
            const res = await fetch(`/_blob/${f.assetId}`);
            if (!res.ok) return null;
            const blob = await unwrap(await res.blob());
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
      if (this.assets && assetId) this.assets.delete(assetId).catch(() => {});
    },

    /* ---------- Состояние в настройках ---------- */

    pill() {
      if (!this.available()) return '';
      if (this.status === 'connecting') return '<span class="pill">Подключаемся…</span>';
      if (this.status === 'error') return '<span class="pill cloud-err">Не сохранено</span>';
      if (this.status === 'off') return '<span class="pill">Недоступно</span>';
      if (this.pushing || this.pushTimer) return '<span class="pill">Сохраняем…</span>';
      return `<span class="pill accent">${U.ico('check')} Сохранено</span>`;
    },

    describe() {
      if (!this.available()) {
        return 'Данные хранятся в этом браузере на этом устройстве. Не очищайте данные сайта и иногда скачивайте резервную копию. Чтобы всё было на всех устройствах, открывайте Семестр через Claude.';
      }
      if (this.status === 'off') return 'Хранилище аккаунта сейчас недоступно — данные сохраняются только в этом браузере.';
      if (this.status === 'error') return `Последнее изменение не сохранилось в аккаунте (${U.esc(this.error)}). Попробуем снова при следующем изменении.`;
      return 'Расписание, дела, заметки и файлы хранятся в вашем аккаунте Claude: не пропадут после перезагрузки и одинаковы на телефоне и компьютере.';
    },

    renderStatus() {
      const el = document.getElementById('cloud-status');
      if (el) el.innerHTML = this.pill();
      const desc = document.getElementById('cloud-desc');
      if (desc) desc.innerHTML = this.describe();
    },
  };

  // Для проверок
  Cloud._merge3 = merge3;
  Cloud._mergeFirst = mergeFirst;

  App.Cloud = Cloud;
})(window.App);
