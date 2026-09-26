/* Семестр — файлы: загрузка, перетаскивание, просмотр, привязка к предметам */
(function (App) {
  'use strict';

  const { U, Store, UI, FileDB } = App;
  const { esc, ico } = U;

  const KINDS = [
    { re: /^pdf$/, hue: 8, pdf: true },
    { re: /^(docx?|odt|rtf|pages)$/, hue: 215 },
    { re: /^(xlsx?|ods|csv|numbers)$/, hue: 140 },
    { re: /^(pptx?|odp|key)$/, hue: 28 },
    { re: /^(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/, hue: 285, image: true },
    { re: /^(mp3|wav|m4a|ogg|flac|aac)$/, hue: 330, audio: true },
    { re: /^(mp4|mov|webm|mkv|avi)$/, hue: 250, video: true },
    { re: /^(zip|rar|7z|tar|gz)$/, hue: 42 },
    { re: /^(txt|md|py|js|ts|java|c|cpp|h|cs|go|rs|json|xml|html|css|sql|tex|m|r|kt|swift|php|rb|yml|yaml|ini|log)$/, hue: 60, text: true },
  ];

  const pending = new Set();
  let pickHandler = null;

  const Files = {
    filter: { q: '', subject: 'all' },

    kind(f) {
      const ext = (f.name.split('.').length > 1 ? f.name.split('.').pop() : '').toLowerCase();
      const k = KINDS.find((x) => x.re.test(ext)) || { hue: 40 };
      const type = f.type || '';
      return {
        ext: (ext || 'файл').slice(0, 4).toUpperCase(),
        hue: k.hue,
        image: !!k.image || /^image\//.test(type),
        pdf: !!k.pdf || type === 'application/pdf',
        audio: !!k.audio || /^audio\//.test(type),
        video: !!k.video || /^video\//.test(type),
        text: !!k.text || /^text\//.test(type) || type === 'application/json',
        neutral: !k.re,
      };
    },

    tile(f, cls = '') {
      const k = this.kind(f);
      return `<span class="ftype ${cls} ${k.neutral ? 'no-subj' : ''}" style="--h:${k.hue}">${esc(k.ext)}</span>`;
    },

    filtered() {
      const q = this.filter.q.trim().toLowerCase();
      const sub = this.filter.subject;
      return Store.state.files.filter((f) => {
        if (sub === 'none' && f.subjectId) return false;
        if (sub !== 'all' && sub !== 'none' && f.subjectId !== sub) return false;
        return !q || f.name.toLowerCase().includes(q);
      });
    },

    uploadSubject() {
      const s = this.filter.subject;
      return s !== 'all' && s !== 'none' && Store.subject(s) ? s : null;
    },

    /* ---------- Экран ---------- */

    render() {
      const st = Store.state;
      if (this.filter.subject !== 'all' && this.filter.subject !== 'none' && !Store.subject(this.filter.subject)) {
        this.filter.subject = 'all';
      }
      const total = st.files.reduce((a, f) => a + (f.size || 0), 0);
      const view = st.settings.filesView;
      const target = Store.subject(this.uploadSubject());
      return `
        <div class="page-head rise" style="--i:0">
          <div>
            <h1 class="page-title">Файлы</h1>
            <p class="page-sub">${st.files.length ? `${U.count(st.files.length, ['файл', 'файла', 'файлов'])} · ${U.fmtSize(total)}` : 'Конспекты, методички и лабы в одном месте'}</p>
          </div>
          <div class="head-actions">
            <button class="btn btn-primary" data-action="files-pick">${ico('upload')} Загрузить</button>
          </div>
        </div>
        <div class="toolbar rise" style="--i:1">
          <label class="search">${ico('search')}<span class="sr-only">Поиск</span>
            <input id="files-q" type="search" placeholder="Поиск по названию" value="${esc(this.filter.q)}" autocomplete="off">
          </label>
          <div class="chips" id="files-chips">${this.chips()}</div>
          ${UI.seg('fv', 'files-view', { grid: ico('grid'), list: ico('list') }, view, 'icons')}
        </div>
        <button class="dropzone rise" style="--i:2" data-action="files-pick" id="files-drop" type="button">
          <span class="dropzone-ico">${ico('upload')}</span>
          <span>
            <span class="dropzone-title">Перетащите файлы сюда или выберите на устройстве</span><br>
            <span class="dropzone-sub">${target ? `Файлы попадут в предмет «${esc(target.name)}»` : 'PDF, документы, фото доски, презентации — любые форматы'}</span>
          </span>
        </button>
        <div id="files-results" class="rise" style="--i:3">${this.results()}</div>`;
    },

    chips() {
      const st = Store.state;
      const cur = this.filter.subject;
      const used = new Set(st.files.map((f) => f.subjectId));
      const subjects = Store.sortedSubjects().filter((s) => used.has(s.id) || s.id === cur);
      const chip = (id, label, extra = '') => `<button class="chip ${cur === id ? 'is-active' : ''}" data-action="files-subj" data-id="${id}" ${extra}>${label}</button>`;
      return [
        chip('all', 'Все'),
        ...subjects.map((s) => chip(s.id, `<span class="dot" style="--h:${s.hue}"></span>${esc(s.name)}`)),
        st.files.some((f) => !f.subjectId) ? chip('none', 'Без предмета') : '',
      ].join('');
    },

    results() {
      const st = Store.state;
      const list = this.filtered();
      if (!list.length) {
        if (!st.files.length) {
          return `<div class="empty"><div class="empty-title">Здесь пока пусто</div><p>Загрузите первый конспект — он сохранится в этом браузере.</p></div>`;
        }
        return `<div class="empty"><div class="empty-title">Ничего не нашлось</div><p>Попробуйте другое название или сбросьте фильтр.</p>
          <button class="btn btn-sm" data-action="files-reset">Показать все файлы</button></div>`;
      }
      if (st.settings.filesView === 'list') {
        return `<div class="files-list">${list.map((f, i) => this.row(f, i)).join('')}</div>`;
      }
      return `<div class="files-grid">${list.map((f, i) => this.card(f, i)).join('')}</div>`;
    },

    card(f, i) {
      const k = this.kind(f);
      const subj = Store.subject(f.subjectId);
      const isPending = pending.has(f.id);
      return `
        <article class="fcard ${isPending ? 'is-pending' : ''}" style="--i:${Math.min(i, 16)}" data-action="file-open" data-id="${f.id}" tabindex="0" role="button" aria-label="Открыть ${esc(f.name)}">
          <div class="fthumb">${this.tile(f)}${k.image ? `<img data-thumb="${f.id}" alt="">` : ''}</div>
          <div class="fbody">
            <div class="fname" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="fmeta">${isPending ? '<span class="shimmer">Сохраняю…</span>' : `${U.fmtSize(f.size)} · ${U.timeAgo(new Date(f.addedAt))}`}</div>
            ${subj ? `<span class="tag" style="--h:${subj.hue}">${esc(subj.name)}</span>` : ''}
          </div>
          ${isPending ? '' : `<div class="factions">
            <button class="icon-btn sm" data-action="file-download" data-id="${f.id}" aria-label="Скачать" title="Скачать">${ico('download')}</button>
            <button class="icon-btn sm" data-action="file-delete" data-id="${f.id}" aria-label="Удалить" title="Удалить">${ico('trash')}</button>
          </div>`}
        </article>`;
    },

    row(f, i) {
      const subj = Store.subject(f.subjectId);
      const isPending = pending.has(f.id);
      return `
        <div class="frow ${isPending ? 'is-pending' : ''}" style="--i:${Math.min(i, 20)}" data-action="file-open" data-id="${f.id}" tabindex="0" role="button">
          ${this.tile(f, 'sm')}
          <span class="frow-name" title="${esc(f.name)}">${isPending ? `<span class="shimmer">${esc(f.name)}</span>` : esc(f.name)}</span>
          <span class="frow-cell">${subj ? `<span class="tag" style="--h:${subj.hue}">${esc(subj.name)}</span>` : ''}</span>
          <span class="frow-cell">${U.fmtSize(f.size)}</span>
          <span class="frow-cell">${U.fmtDate(new Date(f.addedAt))}</span>
          <span class="frow-actions">${isPending ? '' : `
            <button class="icon-btn sm" data-action="file-download" data-id="${f.id}" aria-label="Скачать">${ico('download')}</button>
            <button class="icon-btn sm" data-action="file-delete" data-id="${f.id}" aria-label="Удалить">${ico('trash')}</button>`}
          </span>
        </div>`;
    },

    mount(view) {
      const q = U.$('#files-q', view);
      if (q) {
        q.addEventListener('input', () => {
          this.filter.q = q.value;
          this.refreshResults(view);
        });
      }
    },

    refresh(view) {
      const res = U.$('#files-results', view);
      if (!res) { App.renderView(false); return; }
      const sub = U.$('.page-sub', view);
      const st = Store.state;
      if (sub && st.files.length) {
        sub.textContent = `${U.count(st.files.length, ['файл', 'файла', 'файлов'])} · ${U.fmtSize(st.files.reduce((a, f) => a + (f.size || 0), 0))}`;
      }
      U.$('#files-chips', view).innerHTML = this.chips();
      this.refreshResults(view);
    },

    refreshResults(view) {
      const res = U.$('#files-results', view);
      if (res) res.innerHTML = this.results();
      this.hydrate(view);
    },

    // Подгружает превью картинок из хранилища
    hydrate(root) {
      U.$$('img[data-thumb]', root).forEach(async (img) => {
        if (img.dataset.loaded) return;
        img.dataset.loaded = '1';
        const url = await FileDB.url(img.dataset.thumb);
        if (!url) return;
        img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = url;
      });
    },

    /* ---------- Загрузка ---------- */

    pick(handler, accept = '') {
      const input = U.$('#file-input');
      pickHandler = handler;
      input.accept = accept;
      input.value = '';
      input.click();
    },

    onPicked(list) {
      const h = pickHandler;
      pickHandler = null;
      if (h && list && list.length) h(list);
    },

    async add(list, subjectId = null) {
      const files = Array.from(list || []).filter((f) => f && f.size >= 0);
      if (!files.length) return [];
      const now = new Date().toISOString();
      const metas = files.map((file) => ({
        id: U.uid() + Math.random().toString(36).slice(2, 5),
        name: file.name || 'Без названия',
        size: file.size,
        type: file.type || '',
        subjectId: subjectId || null,
        addedAt: now,
      }));
      metas.forEach((m) => pending.add(m.id));
      Store.state.files.unshift(...metas);
      App.setBusy(true);
      App.refresh();

      let failed = 0;
      const started = Date.now();
      for (let i = 0; i < metas.length; i++) {
        try { await FileDB.put(metas[i].id, files[i]); } catch (e) { failed++; }
      }
      const elapsed = Date.now() - started;
      if (elapsed < 600) await U.sleep(600 - elapsed); // даём увидеть анимацию сохранения
      metas.forEach((m) => pending.delete(m.id));
      Store.save();
      App.setBusy(false);
      App.refresh();

      const n = metas.length;
      const title = n === 1 ? `Файл «${metas[0].name}» сохранён` : `Добавлено ${U.count(n, ['файл', 'файла', 'файлов'])}`;
      UI.toast(title);
      App.Notify.push({
        kind: 'file',
        title: n === 1 ? 'Файл добавлен' : `Добавлено ${U.count(n, ['файл', 'файла', 'файлов'])}`,
        body: metas.map((m) => m.name).slice(0, 3).join(', ') + (n > 3 ? ` и ещё ${n - 3}` : ''),
        route: 'files',
      }, { toast: false, silent: true, read: true });
      if (failed) {
        UI.toast('Часть файлов не поместилась в хранилище браузера — они доступны только до перезагрузки страницы', { timeout: 7000 });
      }
      return metas;
    },

    /* ---------- Просмотр ---------- */

    async open(id) {
      const f = Store.state.files.find((x) => x.id === id);
      if (!f) return;
      const k = this.kind(f);
      const subjects = Store.sortedSubjects();
      const modal = UI.modal({
        focus: 'none',
        title: f.name,
        size: 'wide',
        body: `<div class="preview" id="pv"><span class="shimmer">Открываю…</span></div>`,
        foot: `
          <div class="pv-foot">
            <label class="chip-select" title="Предмет">${ico('book')}
              <span class="sr-only">Предмет</span>
              <select id="pv-subj">
                <option value="">Без предмета</option>
                ${subjects.map((s) => `<option value="${s.id}" ${s.id === f.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
              </select>
            </label>
            <span class="pv-meta">${U.fmtSize(f.size)} · ${U.fmtDate(new Date(f.addedAt))}</span>
            <span class="grow"></span>
            <button class="btn btn-ghost btn-danger" type="button" data-del>${ico('trash')} Удалить</button>
            <button class="btn btn-primary" type="button" data-dl>${ico('download')} Скачать</button>
          </div>`,
        onMount: (el, api) => {
          el.querySelector('#pv-subj').addEventListener('change', (e) => {
            f.subjectId = e.target.value || null;
            delete f.sample;
            Store.gcSubjects();
            Store.save();
            App.refresh();
            const s = Store.subject(f.subjectId);
            UI.toast(s ? `Файл перенесён в «${s.name}»` : 'Предмет у файла убран');
          });
          el.querySelector('[data-dl]').addEventListener('click', () => this.download(id));
          el.querySelector('[data-del]').addEventListener('click', async () => {
            api.close();
            await this.remove(id);
          });
        },
      });

      const pv = modal.el.querySelector('#pv');
      const blob = await FileDB.get(id);
      if (!document.contains(pv)) return;
      if (!blob) {
        pv.innerHTML = `<div class="pv-empty">${this.tile(f)}<p>Файл не найден в хранилище браузера. Возможно, данные сайта были очищены — загрузите его заново.</p></div>`;
        return;
      }
      const url = await FileDB.url(id);
      if (k.image) {
        pv.innerHTML = `<img src="${url}" alt="${esc(f.name)}">`;
      } else if (k.pdf) {
        pv.innerHTML = `<iframe src="${url}" title="${esc(f.name)}"></iframe>`;
      } else if (k.audio) {
        pv.innerHTML = `<audio controls src="${url}"></audio>`;
      } else if (k.video) {
        pv.innerHTML = `<video controls src="${url}"></video>`;
      } else if (k.text && blob.size < 2e6) {
        const text = await blob.slice(0, 400000).text();
        pv.classList.add('is-text');
        pv.innerHTML = `<pre class="pv-text">${esc(text)}</pre>`;
      } else {
        pv.innerHTML = `<div class="pv-empty">${this.tile(f)}<p>Для этого формата предпросмотра нет. Скачайте файл, чтобы открыть его в подходящей программе.</p>
          <button class="btn" type="button" data-dl2>${ico('download')} Скачать</button></div>`;
        pv.querySelector('[data-dl2]').addEventListener('click', () => this.download(id));
      }
    },

    async download(id) {
      const f = Store.state.files.find((x) => x.id === id);
      const blob = f && await FileDB.get(id);
      if (!blob) { UI.toast('Файл не найден в хранилище браузера'); return; }
      const res = await U.saveFile(blob, f.name);
      if (res === 'blocked') UI.toast('В предпросмотре такой файл сохранить нельзя — откройте Семестр на сайте');
    },

    async remove(id) {
      const f = Store.state.files.find((x) => x.id === id);
      if (!f) return;
      const ok = await UI.confirm({
        title: 'Удалить файл?',
        text: `«${f.name}» будет удалён из этого браузера. Отменить это действие нельзя.`,
      });
      if (!ok) return;
      Store.state.files = Store.state.files.filter((x) => x.id !== id);
      await FileDB.del(id);
      Store.gcSubjects();
      Store.save();
      App.refresh();
      UI.toast('Файл удалён');
    },

    /* ---------- Перетаскивание на всё окно ---------- */

    initDrop() {
      const overlay = U.$('#drop-overlay');
      const sub = U.$('#drop-sub');
      let depth = 0;
      const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
      const hide = () => { depth = 0; overlay.classList.remove('is-on'); };

      window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth++;
        if (depth === 1) {
          const target = App.route === 'files' ? Store.subject(this.uploadSubject()) : null;
          sub.textContent = App.route === 'home'
            ? 'Файлы прикрепятся к сообщению — выберите предмет и отправьте'
            : target ? `Сохраним в предмет «${target.name}»` : 'Сохраним в раздел «Файлы»';
          overlay.classList.add('is-on');
        }
      });
      window.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      window.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) hide();
      });
      window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        hide();
        const list = e.dataTransfer.files;
        if (!list || !list.length) return;
        if (App.route === 'home' && App.Home.attach) App.Home.attach(list);
        else this.add(list, App.route === 'files' ? this.uploadSubject() : null);
      });
      window.addEventListener('blur', hide);
    },
  };

  Object.assign(App.actions, {
    'files-pick': () => Files.pick((list) => Files.add(list, Files.uploadSubject())),
    'files-subj': (el) => {
      Files.filter.subject = el.dataset.id;
      App.renderView(false);
    },
    'files-reset': () => {
      Files.filter = { q: '', subject: 'all' };
      App.renderView(false);
    },
    'file-open': (el) => Files.open(el.dataset.id),
    'file-download': (el) => Files.download(el.dataset.id),
    'file-delete': (el) => Files.remove(el.dataset.id),
  });

  Object.assign(App.changes, {
    'files-view': (el, e) => {
      Store.state.settings.filesView = e.target.value;
      Store.save();
      Files.refreshResults(U.$('#view'));
    },
  });

  App.Files = Files;
})(window.App);
