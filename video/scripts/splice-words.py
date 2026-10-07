"""Вклейка записанных вживую сложных слов в синтезированную озвучку.

python scripts/splice-words.py <align.json> [--all] [--scenes 3,25]

align.json — результат нарезки записи слов (номер, слово, файл клипа, уверенность).
Для каждой сцены: Whisper находит слова в public/voice/NN.wav; если термин из списка
синтезирован заметно хуже, чем распознаётся живая запись (или указан --all), его отрезок
заменяется живым клипом — с подгонкой громкости и короткими кроссфейдами.
Оригинал сохраняется как public/voice/NN.synth.wav, повторный запуск берёт его.
"""
import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "public" / "voice"
SR = 24000
FADE = int(0.012 * SR)


def norm(s: str) -> list[str]:
    return re.sub(r"[^а-яё ]", " ", s.lower().replace("ё", "е")).split()


def sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def load(path) -> np.ndarray:
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32).copy()


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def trim(x: np.ndarray, thr_db=-38.0) -> np.ndarray:
    """Срезает тишину по краям клипа."""
    env = np.convolve(np.abs(x), np.ones(240) / 240, "same")
    idx = np.where(20 * np.log10(env + 1e-9) > 20 * np.log10(np.max(env) + 1e-9) + thr_db + 10)[0]
    return x[max(0, idx[0] - 120): idx[-1] + 240] if len(idx) else x


def quiet_point(x: np.ndarray, t: int, radius: int) -> int:
    """Ближайшая к t точка минимальной энергии — чтобы резать в паузе/на стыке слогов."""
    lo, hi = max(0, t - radius), min(len(x), t + radius)
    if hi - lo < 480:
        return t
    env = np.convolve(x[lo:hi] ** 2, np.ones(240) / 240, "same")
    return lo + int(np.argmin(env))


def heard_words(asr, audio: np.ndarray, prompt: str):
    a16 = np.interp(np.arange(0, len(audio), SR / 16000), np.arange(len(audio)), audio).astype(np.float32)
    segs, _ = asr.transcribe(a16, language="ru", beam_size=5, word_timestamps=True,
                             condition_on_previous_text=False, initial_prompt=prompt[:600])
    out = []
    for s in segs:
        for w in s.words or []:
            for t in norm(w.word):
                out.append((t, w.start, w.end))
    return out


def align(ref: list[str], heard):
    """Нечёткое выравнивание: для каждого слова текста — индекс услышанного слова или None."""
    n, k = len(ref), len(heard)
    dp = np.zeros((n + 1, k + 1))
    bt = np.zeros((n + 1, k + 1), np.int8)
    for i in range(1, n + 1):
        for j in range(1, k + 1):
            s = sim(ref[i - 1], heard[j - 1][0])
            opts = (dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + (s if s >= 0.4 else -0.2))
            bt[i][j] = int(np.argmax(opts))
            dp[i][j] = max(opts)
    res = [None] * n
    i, j = n, k
    while i and j:
        if bt[i][j] == 2:
            res[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif bt[i][j] == 0:
            i -= 1
        else:
            j -= 1
    return res


def main():
    args = sys.argv[1:]
    replace_all = "--all" in args
    args = [a for a in args if a != "--all"]
    only = None
    if "--scenes" in args:
        k = args.index("--scenes")
        only = {int(x) for x in args[k + 1].split(",")}
        del args[k: k + 2]
    words = [w for w in json.load(open(args[0])) if w.get("ok")]
    scenes = json.loads((ROOT / "src" / "lecture.json").read_text())["scenes"]
    asr = WhisperModel("small", device="cpu", compute_type="int8")

    # насколько хорошо Whisper узнаёт каждое живое слово (эталон для сравнения с синтезом)
    clips = {}
    for w in words:
        clip = trim(load(w["file"]))
        h = " ".join(t for t, _, _ in heard_words(asr, clip, w["word"]))
        clips[w["word"].lower()] = (clip, sim(" ".join(norm(w["word"])), h))

    log = []
    for idx, scene in enumerate(scenes, 1):
        if only and idx not in only:
            continue
        path, orig = VOICE / f"{idx:02d}.wav", VOICE / f"{idx:02d}.synth.wav"
        if not path.exists():
            continue
        if not orig.exists():
            shutil.copy(path, orig)
        audio = load(orig)
        ref = norm(scene["narration"])
        heard = heard_words(asr, audio, scene["narration"])
        pos = align(ref, heard)
        # вхождения терминов (в т.ч. из двух слов) в тексте сцены
        jobs = []
        for key, (clip, live_score) in clips.items():
            kt = norm(key)
            for i in range(len(ref) - len(kt) + 1):
                if ref[i: i + len(kt)] != kt:
                    continue
                hj = [pos[i + d] for d in range(len(kt))]
                if any(h is None for h in hj):
                    continue
                synth_score = sim(" ".join(kt), " ".join(heard[h][0] for h in hj))
                if replace_all or synth_score < min(0.75, live_score - 0.1):
                    jobs.append((heard[hj[0]][1], heard[hj[-1]][2], key, clip, synth_score, live_score))
        if not jobs:
            continue
        out, cur = [], 0
        for st, en, key, clip, s_score, l_score in sorted(jobs):
            a = quiet_point(audio, int(st * SR), int(0.06 * SR))
            b = quiet_point(audio, int(en * SR), int(0.06 * SR))
            if a < cur or b - a < int(0.1 * SR):
                continue
            ctx = audio[max(0, a - SR): min(len(audio), b + SR)]
            c = clip * (rms(ctx[np.abs(ctx) > 0.01]) / rms(clip[np.abs(clip) > 0.01]))
            c = c.copy()
            c[:FADE] *= np.linspace(0, 1, FADE)
            c[-FADE:] *= np.linspace(1, 0, FADE)
            left = audio[cur:a].copy()
            left[-FADE:] *= np.linspace(1, 0, min(FADE, len(left)))[-len(left[-FADE:]):]
            out += [left, c]
            cur = b
            log.append(f"{idx:02d}: «{key}» синтез {s_score:.0%} → живой голос ({l_score:.0%})")
        right = audio[cur:].copy()
        right[:FADE] *= np.linspace(0, 1, min(FADE, len(right)))
        sf.write(path, np.concatenate(out + [right]), SR)
    print("\n".join(log) or "замен нет")
    print(f"всего замен: {len(log)}")


if __name__ == "__main__":
    main()
