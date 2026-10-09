#!/usr/bin/env node
/* Собирает файл календаря для группы тем же кодом, что и сайт.

   node tools/build-ics.js            — группа 314, с сегодняшнего дня до конца семестра
   node tools/build-ics.js 305 all    — другая группа, весь семестр

   Файл появится в calendar/semestr-<группа>.ics */
'use strict';

const fs = require('fs');
const path = require('path');

process.env.TZ = 'Europe/Kirov';
const root = path.resolve(__dirname, '..');
const group = process.argv[2] || '314';
const period = process.argv[3] === 'all' ? 'all' : 'rest';
const lead = 15;

global.window = {};
global.Blob = class { constructor(parts, o) { this.parts = parts; this.type = (o || {}).type; } };
['utils', 'data/kgmu-3-lech-2026', 'data/kgmu-topics', 'kgmu', 'store', 'ui', 'schedule', 'topics', 'calendar']
  .forEach((f) => require(path.join(root, 'js', `${f}.js`)));

const { Store, KGMU, Calendar, U } = window.App;
Store.load();
// Как при первом открытии сайта: все обязательные дисциплины и элективы, на которые записана группа
const chosen = new Set(KGMU.chosenElectives(group));
const include = new Set(KGMU.summary(group).filter((it) => (it.elective ? chosen.has(it.key) : true)).map((it) => it.key));
if (!include.size || !KGMU.apply(group, include, { silent: true })) {
  console.error(`Группа ${group} не найдена в расписании`);
  process.exit(1);
}
// Примеры со стартового экрана в календарь не нужны — только занятия группы
Store.state.classes = Store.state.classes.filter((c) => !c.sample);
const events = Calendar.classEvents(period, lead);
const file = path.join(root, 'calendar', `semestr-${group}.ics`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, Calendar.ics(events, Calendar.calName()));

const first = events[0];
const last = events[events.length - 1];
const fmt = (d) => U.ymd(d);
console.log(`${path.relative(root, file)}: ${events.length} занятий, ${first ? fmt(first.start) : '—'} … ${last ? fmt(last.start) : '—'}`);
