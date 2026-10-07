// Генерирует SCRIPT.md — текст для озвучки, по одному блоку на сцену.
import fs from "node:fs";

const lecture = JSON.parse(fs.readFileSync(new URL("../src/lecture.json", import.meta.url)));
const pad = (n) => String(n).padStart(2, "0");
const sectionTitle = (n) => lecture.sections.find((s) => s.n === n)?.title;

let md = `# Текст для озвучки\n\n`;
md += `Каждая сцена — отдельный файл. Имя файла = номер сцены: \`01.m4a\`, \`02.m4a\` … (подойдут m4a, mp3, wav, ogg, opus).\n`;
md += `В скобках — номера слайдов исходной презентации.\n\n`;
let words = 0;
let current = -1;
lecture.scenes.forEach((s, i) => {
  if (s.section !== current && s.section > 0) md += `\n## ${s.section}. ${sectionTitle(s.section)}\n\n`;
  current = s.section;
  md += `### ${pad(i + 1)} · ${s.heading} (сл. ${s.src.join(", ")})\n\n${s.narration}\n\n`;
  words += s.narration.split(/\s+/).length;
});
md += `---\nВсего сцен: ${lecture.scenes.length}, слов: ${words}, ориентировочно ${Math.round(words / 130)} мин при темпе 130 слов/мин.\n`;
fs.writeFileSync(new URL("../SCRIPT.md", import.meta.url), md);
console.log(`SCRIPT.md: ${lecture.scenes.length} сцен, ${words} слов`);
