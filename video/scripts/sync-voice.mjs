// Берёт записи из public/voice (NN.m4a|mp3|wav|ogg|opus|aac), чистит и нормализует громкость,
// кладёт в public/voice-processed/NN.wav и записывает длительности в src/voice.json.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const inDir = path.join(root, "public/voice");
const outDir = path.join(root, "public/voice-processed");
fs.mkdirSync(outDir, { recursive: true });

const sceneCount = JSON.parse(fs.readFileSync(path.join(root, "src/lecture.json"))).scenes.length;
const durations = {};
const files = fs.existsSync(inDir) ? fs.readdirSync(inDir) : [];
for (const f of files.sort()) {
  if (f.startsWith(".")) continue;
  const m = f.match(/^(\d{1,3})\.(m4a|mp3|wav|ogg|opus|aac|webm|flac)$/i);
  if (!m) { console.warn(`пропущен: ${f} (ожидается имя вида 07.m4a)`); continue; }
  const id = String(Number(m[1])).padStart(2, "0");
  if (Number(id) < 1 || Number(id) > sceneCount) { console.warn(`нет сцены ${id}: ${f}`); continue; }
  const out = path.join(outDir, `${id}.wav`);
  // обрезка тишины в начале/конце, затем выравнивание средней громкости к −20 dB с ограничителем пиков
  // (loudnorm здесь не используется: на некоторых файлах ffmpeg на нём зависает)
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse";
  const probe = spawnSync("ffmpeg", ["-nostdin", "-i", path.join(inDir, f), "-af", `${trim},volumedetect`, "-f", "null", "-"], { encoding: "utf8" });
  const mean = Number((probe.stderr.match(/mean_volume: (-?[\d.]+) dB/) || [])[1] ?? -20);
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", path.join(inDir, f),
    "-af", `${trim},volume=${(-20 - mean).toFixed(2)}dB,alimiter=limit=0.89:level=false`,
    "-ar", "48000", "-ac", "1", out], { stdio: "ignore" });
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
  durations[id] = Math.round(d * 100) / 100;
}
fs.writeFileSync(path.join(root, "src/voice.json"), JSON.stringify(durations, null, 2) + "\n");
const missing = Array.from({ length: sceneCount }, (_, i) => String(i + 1).padStart(2, "0")).filter((id) => !durations[id]);
console.log(`озвучено сцен: ${Object.keys(durations).length}/${sceneCount}`);
if (missing.length) console.log(`без голоса (будут по оценочному времени): ${missing.join(", ")}`);
