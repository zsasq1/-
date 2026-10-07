"""Озвучка сцен клонированным голосом (XTTS-v2).

python scripts/clone-voice.py <образец_голоса> [номера сцен через запятую]
Пишет public/voice/NN.wav; уже готовые сцены пропускает (удалите файл, чтобы пересинтезировать).
"""
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("COQUI_TOS_AGREED", "1")
import torch  # noqa: E402
import torchaudio  # noqa: E402
from TTS.api import TTS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "voice"
SR = 24000
MAX_CHARS = 180  # у XTTS для русского лимит ~182 символа на фрагмент
MIN_CHARS = 70  # короче — перебалансировать с соседом
TRIES = 3  # попыток на фразу, если распознанный текст расходится со сценарием
GOOD = 0.8  # порог совпадения (Whisper сам ошибается в терминах, 100% не бывает)

# Как произносить аббревиатуры
SAY = {"ДВС": "дэвээс", "АТФ": "аТэЭф", "ТЭЛА": "тээла"}


def prepare(text: str) -> str:
    for k, v in SAY.items():
        text = re.sub(rf"\b{k}\b", v, text)
    return text.replace("«", "").replace("»", "").replace("…", ".")


def chunks(text: str) -> list[str]:
    """Режет текст на предложения, длинные — по ; : — , так, чтобы куски были ≤ MAX_CHARS."""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", text.strip()):
        parts = [sent]
        for sep in [r"(?<=;)\s+", r"(?<=:)\s+", r"\s+(?=— )", r"(?<=,)\s+"]:
            nxt = []
            for p in parts:
                if len(p) <= MAX_CHARS:
                    nxt.append(p)
                    continue
                buf = ""
                for piece in re.split(sep, p):
                    if buf and len(buf) + len(piece) + 1 > MAX_CHARS:
                        nxt.append(buf)
                        buf = piece
                    else:
                        buf = f"{buf} {piece}".strip()
                if buf:
                    nxt.append(buf)
            parts = nxt
        out.extend(parts)
    # короткие куски XTTS озвучивает хуже — склеиваем соседние, пока помещаются в лимит
    packed = []
    for c in (c for c in out if c.strip()):
        if packed and len(packed[-1]) + len(c) + 1 <= MAX_CHARS:
            packed[-1] += " " + c
        else:
            packed.append(c)
    # слишком короткий кусок объединяем с предыдущим и делим пару пополам по знаку препинания
    for k in range(len(packed) - 1, 0, -1):
        if len(packed[k]) >= MIN_CHARS:
            continue
        both = packed[k - 1] + " " + packed[k]
        cuts = [m.end() for m in re.finditer(r"[.;:,](?=\s)|\s(?=— )", both)]
        cuts = [c for c in cuts if len(both[:c]) <= MAX_CHARS and len(both[c:].strip()) <= MAX_CHARS]
        if cuts:
            c = min(cuts, key=lambda c: abs(c - len(both) / 2))
            packed[k - 1 : k + 1] = [both[:c].strip(), both[c:].strip()]
    return packed


def clean_reference(src: str) -> str:
    """Образец → моно 24 кГц wav, без тишины по краям, с нормализацией громкости."""
    dst = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af",
         "highpass=f=70,afftdn=nf=-40:nr=12,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-18",
         "-ar", str(SR), "-ac", "1", dst],
        check=True,
    )
    return dst


def words(s: str) -> list[str]:
    return re.sub(r"[^а-яё ]", " ", s.lower().replace("ё", "е")).split()


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


class Checker:
    """Распознаёт фразу Whisper'ом: оценивает совпадение с текстом и находит конец последнего слова,
    чтобы срезать «хвост» — бессмысленные слоги, которые XTTS иногда добавляет в конце."""

    def __init__(self):
        from faster_whisper import WhisperModel
        self.asr = WhisperModel("small", device="cpu", compute_type="int8")

    def __call__(self, wav: torch.Tensor, text: str):
        audio = torchaudio.functional.resample(wav, SR, 16000).numpy()
        segs, _ = self.asr.transcribe(audio, language="ru", beam_size=5, word_timestamps=True,
                                      condition_on_previous_text=False)
        heard = [(words(w.word), w.end) for s in segs for w in (s.words or [])]
        heard = [(" ".join(w), end) for w, end in heard if w]
        ref = words(text)
        if not heard or not ref:
            return 0.0, None
        # нечёткое выравнивание слов текста и распознанных слов (латынь Whisper слышит неточно)
        n, m = len(ref), len(heard)
        dp = [[0.0] * (m + 1) for _ in range(n + 1)]
        for a in range(1, n + 1):
            for b in range(1, m + 1):
                sim = similar(ref[a - 1], heard[b - 1][0])
                dp[a][b] = max(dp[a - 1][b], dp[a][b - 1], dp[a - 1][b - 1] + (sim if sim >= 0.5 else 0))
        score = dp[n][m] / n
        # последняя сопоставленная пара
        a, b = n, m
        while a and b:
            sim = similar(ref[a - 1], heard[b - 1][0])
            if sim >= 0.5 and abs(dp[a][b] - dp[a - 1][b - 1] - sim) < 1e-9:
                break
            if dp[a][b] == dp[a - 1][b]:
                a -= 1
            else:
                b -= 1
        if not (a and b):
            return score, None
        # после неё оставляем не больше слов, чем осталось несопоставленных в тексте
        keep = b + min(n - a, m - b)
        return score, int((heard[keep - 1][1] + 0.3) * SR)


def main():
    ref = clean_reference(sys.argv[1])
    only = {int(x) for x in sys.argv[2].split(",")} if len(sys.argv) > 2 else None
    scenes = json.loads((ROOT / "src" / "lecture.json").read_text())["scenes"]
    OUT.mkdir(parents=True, exist_ok=True)

    torch.set_num_threads(os.cpu_count() or 4)
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").synthesizer.tts_model
    gpt_latent, spk_emb = model.get_conditioning_latents(audio_path=[ref], gpt_cond_len=30, max_ref_length=60)
    check = Checker()

    pause = torch.zeros(int(SR * 0.28))
    for i, scene in enumerate(scenes, 1):
        target = OUT / f"{i:02d}.wav"
        if (only and i not in only) or (not only and target.exists()):
            continue
        pieces, scores = [], []
        for c in chunks(prepare(scene["narration"])):
            best = (-1.0, None)
            for attempt in range(TRIES):
                torch.manual_seed(attempt)
                wav = torch.as_tensor(model.inference(
                    c, "ru", gpt_latent, spk_emb, temperature=0.6 + 0.05 * attempt,
                    repetition_penalty=5.0, top_p=0.85, enable_text_splitting=False)["wav"]).float()
                score, cut = check(wav, c)
                if cut is not None:
                    wav = wav[:cut]
                if score > best[0]:
                    best = (score, wav)
                if score >= GOOD and cut is not None:
                    break
            scores.append(best[0])
            if best[0] < GOOD:
                print(f"   ! сцена {i:02d}, совпадение {best[0]:.0%}: {c}", flush=True)
            pieces += [best[1], pause]
        torchaudio.save(str(target), torch.cat(pieces[:-1]).unsqueeze(0), SR)
        print(f"{i:02d} готово (мин. совпадение фраз {min(scores):.0%})", flush=True)


if __name__ == "__main__":
    main()
