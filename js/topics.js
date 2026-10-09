/* Семестр — темы занятий из рабочих программ КГМУ, разложенные по датам расписания */
(function (App) {
  'use strict';

  const { U, Store, UI } = App;
  const { esc, ico } = U;

  const FINAL_RE = /(итогов|контрольн|зачетн|зачётн|тестов\S* контрол)/i;

  let cache = { rev: -1, day: '', map: null };
  let finalsCache = { rev: -1, list: [] };

  const Topics = {
    kindOf(type) {
      return type === 'lecture' ? 'lecture' : 'practice';
    },

    // Номер семестра и его границы: осенью 3 курса — 5-й, весной — 6-й
    semester() {
      const st = Store.state;
      const start = U.parseYmd(st.settings.semesterStart);
      const fall = start.getMonth() >= 7;
      const course = Number(st.profile.course) || 3;
      const end = fall ? new Date(start.getFullYear() + 1, 0, 31) : new Date(start.getFullYear(), 6, 31);
      return { no: course * 2 - (fall ? 1 : 0), start, end };
    },

    plan(subjectName, kind) {
      const data = App.KGMU_TOPICS && App.KGMU_TOPICS[subjectName];
      if (!data) return null;
      const sem = data.sem[String(this.semester().no)];
      return sem && sem[kind] ? { list: sem[kind], src: data.src } : null;
    },

    // Академические часы занятия: 90 минут = 2 часа, «8.00–10.25» = 3 часа
    acHours(c) {
      return Math.max(1, Math.round((U.toMin(c.end) - U.toMin(c.start)) / 47.5));
    },

    // Все занятия семестра по каждой дисциплине и виду, с темами
    build() {
      const key = `${Store.rev}|${Store.state.classes.length}`;
      if (cache.map && cache.rev === key) return cache.map;
      const { start, end } = this.semester();
      const map = new Map();
      for (let d = new Date(start); d <= end; d = U.addDays(d, 1)) {
        App.Schedule.classesOn(d).forEach((c) => {
          const s = Store.subject(c.subjectId);
          if (!s) return;
          const k = `${s.name}|${this.kindOf(c.type)}`;
          if (!map.has(k)) map.set(k, { subject: s.name, kind: this.kindOf(c.type), occ: [] });
          map.get(k).occ.push({ date: U.ymd(d), start: c.start, end: c.end, classId: c.id, hours: this.acHours(c) });
        });
      }
      map.forEach((entry) => {
        entry.occ.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        const plan = this.plan(entry.subject, entry.kind);
        entry.plan = plan;
        if (plan) assign(entry.occ, plan.list);
      });
      cache = { rev: key, map };
      return map;
    },

    noteKey(subject, kind, date, start) {
      return `${subject}|${kind}|${date}|${start}`;
    },

    // Тема конкретного занятия: { n, total, items, custom, note, final }
    lookup(c, date) {
      const s = Store.subject(c.subjectId);
      if (!s) return null;
      const kind = this.kindOf(c.type);
      const iso = typeof date === 'string' ? date : U.ymd(date);
      const note = Store.state.topicNotes[this.noteKey(s.name, kind, iso, c.start)] || {};
      const entry = this.build().get(`${s.name}|${kind}`);
      const idx = entry ? entry.occ.findIndex((o) => o.date === iso && o.start === c.start) : -1;
      const occ = idx >= 0 ? entry.occ[idx] : null;
      const items = occ && occ.topics ? occ.topics.map((i) => entry.plan.list[i]) : [];
      const label = note.topic || (items.length ? items.map((t) => t.d || t.t).join(' · ') : '');
      const fi = occ && occ.topics && entry.plan ? occ.topics.find((i) => FINAL_RE.test(entry.plan.list[i].t)) : undefined;
      return {
        subject: s.name, kind, date: iso,
        n: idx + 1, total: entry ? entry.occ.length : 0,
        items, continued: !!(occ && occ.continued),
        custom: note.topic || '', note: note.note || '',
        label, final: FINAL_RE.test(label),
        // К итоговому: что на нём будет и какие темы раздела повторить
        about: fi != null && !note.topic ? entry.plan.list[fi].c || '' : '',
        know: fi != null && !note.topic ? this.knowFor(entry, fi) : [],
        passed: !!note.passed,
        hasPlan: !!(entry && entry.plan),
        src: entry && entry.plan ? entry.plan.src : '',
        entry,
      };
    },

    // Темы раздела, которые проверяют на итоговом: от прошлого итогового до этого
    knowFor(entry, fi) {
      const list = entry.plan.list;
      let p = fi - 1;
      while (p >= 0 && !FINAL_RE.test(list[p].t)) p--;
      const out = [];
      for (let i = p + 1; i < fi; i++) {
        const o = entry.occ.find((x) => x.topics && x.topics.includes(i));
        out.push({ t: list[i].t, date: o ? o.date : '' });
      }
      return out;
    },

    // Все итоговые и зачётные занятия семестра по датам — они же дедлайны
    finals() {
      const key = `${Store.rev}|${Store.state.classes.length}`;
      if (finalsCache.rev === key) return finalsCache.list;
      const list = [];
      this.build().forEach((e) => {
        e.occ.forEach((o) => {
          const c = Store.state.classes.find((x) => x.id === o.classId);
          const t = c && this.lookup(c, o.date);
          // Итоговое на два занятия подряд — один дедлайн, по первому
          if (!t || !t.final || (t.continued && !t.custom)) return;
          const at = U.atTime(U.parseYmd(o.date), o.start);
          list.push({
            id: this.noteKey(t.subject, t.kind, o.date, o.start),
            subject: t.subject, subjectId: c.subjectId, classId: c.id,
            date: o.date, start: o.start, end: o.end, at, endAt: U.atTime(U.parseYmd(o.date), o.end),
            title: t.custom || (t.items.find((it) => FINAL_RE.test(it.t)) || {}).t || t.label,
            about: t.about, know: t.know, note: t.note, passed: t.passed,
            where: App.Schedule.roomText(c) || App.Schedule.placeShort(c),
          });
        });
      });
      list.sort((a, b) => a.at - b.at);
      finalsCache = { rev: key, list };
      return list;
    },

    setPassed(id, passed) {
      const cur = Object.assign({}, Store.state.topicNotes[id] || {});
      if (passed) cur.passed = true; else delete cur.passed;
      if (Object.keys(cur).length) Store.state.topicNotes[id] = cur;
      else delete Store.state.topicNotes[id];
      Store.save();
    },

    // Короткая строка для сетки и списков
    line(c, date) {
      const t = this.lookup(c, date);
      if (!t || !t.label) return null;
      return { text: (t.continued && !t.custom ? 'Продолжение: ' : '') + t.label, final: t.final, note: t.note };
    },

    saveNote(t, patch) {
      const key = this.noteKey(t.subject, t.kind, t.date, t.start);
      const cur = Object.assign({}, Store.state.topicNotes[key] || {}, patch);
      if (!cur.topic) delete cur.topic;
      if (!cur.note) delete cur.note;
      if (Object.keys(cur).length) Store.state.topicNotes[key] = cur;
      else delete Store.state.topicNotes[key];
      Store.save();
    },

    /* ---------- Окно занятия ---------- */

    open(classId, date) {
      const c = Store.state.classes.find((x) => x.id === classId);
      if (!c) return;
      const iso = date || U.ymd(new Date());
      const t = this.lookup(c, iso);
      if (!t) { App.Schedule.openModal(c); return; }
      t.start = c.start;
      const d = U.parseYmd(iso);
      const subj = Store.subject(c.subjectId);
      const where = [App.Schedule.roomText(c), c.place].filter(Boolean).join(' · ');
      const known = App.KGMU && App.KGMU.SUBJECTS.find((x) => x.name === t.subject);
      const choosePatofiz = known && known.placeholder;

      const topicBlock = () => {
        if (choosePatofiz) {
          return `
            <div class="occ-choose">
              <p>Какой курс на кафедре патофизиологии? Выберите — и появятся темы всех занятий.</p>
              <div class="occ-choose-btns">
                <button class="btn" type="button" data-pick="Молекулярные механизмы в патологии человека">Молекулярные механизмы в патологии человека</button>
                <button class="btn" type="button" data-pick="Функциональная диагностика донозологических состояний">Функциональная диагностика донозологических состояний</button>
              </div>
            </div>`;
        }
        if (!t.items.length) {
          return `<p class="occ-empty">${t.hasPlan ? 'Занятий в расписании больше, чем тем в программе — это, скорее всего, резерв или отработка.' : 'Для этой дисциплины тем в программе нет — впишите свою ниже.'}</p>`;
        }
        return t.items.map((it, i) => `
          <div class="occ-topic-item">
            <div class="occ-title">${i === 0 && t.continued ? '<span class="pill">продолжение</span> ' : ''}${esc(it.t)}${FINAL_RE.test(it.t) ? ' <span class="pill accent">итоговое</span>' : ''}</div>
            ${it.c ? `<p class="occ-content">${esc(it.c)}</p>` : ''}
          </div>`).join('');
      };

      const courseList = () => {
        const e = t.entry;
        if (!e || !e.occ.length) return '';
        const nowIso = U.ymd(new Date());
        return `
          <details class="more span-2">
            <summary>Все ${t.kind === 'lecture' ? 'лекции' : 'занятия'} семестра · ${e.occ.length}</summary>
            <ol class="occ-list more-body">
              ${e.occ.map((o) => {
                const note = Store.state.topicNotes[this.noteKey(t.subject, t.kind, o.date, o.start)] || {};
                const label = note.topic || (o.topics ? o.topics.map((i) => e.plan.list[i].d || e.plan.list[i].t).join(' · ') : '—');
                return `<li class="${o.date === iso && o.start === c.start ? 'is-current' : ''} ${o.date < nowIso ? 'is-past' : ''}">
                  <time>${o.date.slice(8)}.${o.date.slice(5, 7)}</time><span>${o.continued && !note.topic ? 'Продолжение: ' : ''}${esc(label)}</span></li>`;
              }).join('')}
            </ol>
          </details>`;
      };

      UI.modal({
        focus: 'none',
        title: subj ? subj.name : 'Занятие',
        body: `
          <div class="occ">
            <div class="occ-meta">
              <span>${ico('calendar')}${esc(U.cap(U.fmtDayLong(d)))}, ${c.start}–${c.end}</span>
              <span>${ico('book')}${esc(Store.CLASS_TYPES_FULL[c.type] || '')}${t.n > 0 ? ` · ${t.kind === 'lecture' ? 'лекция' : 'занятие'} ${t.n} из ${t.total}` : ''}</span>
              ${where ? `<span>${ico('pin')}${esc(where)}</span>` : ''}
            </div>
            <section class="occ-box ${Store.subjClass(c.subjectId)}" id="occ-topics" style="${Store.subjStyle(c.subjectId)}">
              <div class="occ-label">Тема по рабочей программе</div>
              ${topicBlock()}
            </section>
            ${t.final && t.know.length ? `
            <section class="occ-know">
              <div class="occ-label">Что надо знать к итоговому · ${U.count(t.know.length, ['тема', 'темы', 'тем'])}</div>
              <ol class="know-list">${t.know.map((k) => `<li><span>${esc(k.t)}</span>${k.date ? `<time>${k.date.slice(8)}.${k.date.slice(5, 7)}</time>` : ''}</li>`).join('')}</ol>
            </section>` : ''}
            <div class="form-grid">
              <div class="field span-2">
                <label for="occ-topic">Своя тема</label>
                <input id="occ-topic" class="input" value="${esc(t.custom)}" placeholder="Если на кафедре идут по другой теме, впишите её">
              </div>
              <div class="field span-2">
                <label for="occ-note">Заметка к занятию</label>
                <textarea id="occ-note" class="input occ-note" rows="3" placeholder="Что подготовить, что взять с собой, вопросы к преподавателю">${esc(t.note)}</textarea>
              </div>
              ${courseList()}
            </div>
            ${t.src ? `<p class="field-hint">Темы взяты из <a class="link" href="${esc(t.src)}" target="_blank" rel="noopener">рабочей программы дисциплины</a> и разложены по датам по порядку, с учётом часов занятия и праздников. Если кафедра идёт в другом темпе, впишите свою тему.</p>` : ''}
          </div>`,
        foot: `
          <button class="btn btn-ghost occ-edit" type="button" data-edit aria-label="Изменить расписание" title="Изменить расписание">${ico('pencil')}<span class="occ-edit-text">Изменить</span></button>
          <button class="btn btn-ghost" type="button" data-action="cal-menu" data-id="${esc(c.id)}" data-date="${esc(iso)}" aria-haspopup="menu">${ico('calendar-plus')} В календарь</button>
          <span class="spacer"></span>
          ${t.final ? `<button class="btn ${t.passed ? 'is-on' : ''}" type="button" data-passed aria-pressed="${t.passed}" title="Отметить итоговое сданным">${ico('check')}Сдано</button>` : ''}
          <button class="btn btn-primary" type="button" data-close>Готово</button>`,
        onMount: (el, api) => {
          const save = U.debounce(() => {
            this.saveNote(t, { topic: el.querySelector('#occ-topic').value.trim(), note: el.querySelector('#occ-note').value.trim() });
            App.refresh();
          }, 400);
          el.querySelector('#occ-topic').addEventListener('input', save);
          el.querySelector('#occ-note').addEventListener('input', save);
          el.querySelector('[data-edit]').addEventListener('click', () => { api.close(); App.Schedule.openModal(c); });
          const passBtn = el.querySelector('[data-passed]');
          if (passBtn) passBtn.addEventListener('click', () => {
            t.passed = !t.passed;
            this.setPassed(this.noteKey(t.subject, t.kind, iso, c.start), t.passed);
            passBtn.classList.toggle('is-on', t.passed);
            passBtn.setAttribute('aria-pressed', t.passed);
            App.refresh();
          });
          U.$$('[data-pick]', el).forEach((b) => b.addEventListener('click', () => {
            this.renameSubject(t.subject, b.dataset.pick);
            api.close();
            setTimeout(() => this.open(classId, iso), 240);
          }));
          const cur = el.querySelector('.occ-list .is-current');
          const det = el.querySelector('details.more');
          if (det && cur) det.addEventListener('toggle', () => cur.scrollIntoView({ block: 'center' }), { once: true });
        },
      });
    },

    // Выбран конкретный курс вместо общего «Электив на кафедре патофизиологии»
    renameSubject(from, to) {
      const st = Store.state;
      const old = st.subjects.find((s) => s.name === from);
      if (!old) return;
      const target = Store.subjectByName(to, old.hue);
      st.classes.forEach((c) => { if (c.subjectId === old.id) c.subjectId = target.id; });
      st.reminders.forEach((r) => { if (r.subjectId === old.id) r.subjectId = target.id; });
      st.files.forEach((f) => { if (f.subjectId === old.id) f.subjectId = target.id; });
      st.settings.electiveCourses = (st.settings.electiveCourses || []).map((x) => (x === from ? to : x));
      Store.gcSubjects();
      Store.save();
      App.refresh();
      UI.toast(`Курс выбран: ${to}`);
    },
  };

  /* Раскладка тем по занятиям пропорционально часам.
     Каждому занятию — тема, на которую приходится больше всего его времени; короткие темы,
     которые не стали ни для кого основными, дописываются к занятию, где их больше всего.
     Если часов в расписании столько же, сколько в программе, получается одна тема на занятие. */
  function assign(occ, list) {
    const H = list.reduce((a, t) => a + (Number(t.h) || 0), 0);
    const S = occ.reduce((a, o) => a + o.hours, 0);
    if (!H || !S) return;
    const scale = H / S;
    const bounds = [];
    let acc = 0;
    list.forEach((t) => { bounds.push([acc, acc + (Number(t.h) || 0)]); acc += Number(t.h) || 0; });

    let pos = 0;
    const overlaps = occ.map((o) => {
      const a = pos * scale;
      const b = (pos + o.hours) * scale;
      pos += o.hours;
      return bounds.map(([t0, t1]) => Math.max(0, Math.min(b, t1) - Math.max(a, t0)));
    });

    const used = new Set();
    occ.forEach((o, k) => {
      let best = 0;
      overlaps[k].forEach((v, j) => { if (v > overlaps[k][best] + 1e-9) best = j; });
      o.topics = overlaps[k][best] > 0 ? [best] : [];
      if (o.topics.length) used.add(best);
    });
    list.forEach((_, j) => {
      if (used.has(j)) return;
      let where = -1;
      occ.forEach((o, k) => { if (overlaps[k][j] > 0 && (where < 0 || overlaps[k][j] > overlaps[where][j])) where = k; });
      if (where >= 0) {
        occ[where].topics.push(j);
        occ[where].topics.sort((x, y) => x - y);
      }
    });
    occ.forEach((o, k) => {
      const prev = k > 0 ? occ[k - 1].topics : [];
      o.continued = o.topics.length > 0 && prev.includes(o.topics[0]);
    });
  }

  Object.assign(App.actions, {
    'occ-open': (el) => Topics.open(el.dataset.id, el.dataset.date),
    'final-toggle': (el) => {
      const f = Topics.finals().find((x) => x.id === el.dataset.key);
      if (!f) return;
      Topics.setPassed(f.id, !f.passed);
      App.refresh();
      if (!f.passed) UI.toast(`Итоговое по предмету «${f.subject}» сдано`);
    },
  });

  App.Topics = Topics;
})(window.App);
