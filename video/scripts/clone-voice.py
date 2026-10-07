"""Озвучка сцен клонированным голосом (XTTS-v2).

python scripts/clone-voice.py <образец_голоса> [номера сцен через запятую]
Пишет public/voice/NN.wav; уже готовые сцены пропускает (удалите файл, чтобы пересинтезировать).
"""
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
    return [c for c in out if c.strip()]


def clean_reference(src: str) -> str:
    """Образец → моно 24 кГц wav, без тишины по краям, с нормализацией громкости."""
    dst = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af",
         "highpass=f=70,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-18",
         "-ar", str(SR), "-ac", "1", dst],
        check=True,
    )
    return dst


def main():
    ref = clean_reference(sys.argv[1])
    only = {int(x) for x in sys.argv[2].split(",")} if len(sys.argv) > 2 else None
    scenes = json.loads((ROOT / "src" / "lecture.json").read_text())["scenes"]
    OUT.mkdir(parents=True, exist_ok=True)

    torch.set_num_threads(os.cpu_count() or 4)
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").synthesizer.tts_model
    gpt_latent, spk_emb = model.get_conditioning_latents(audio_path=[ref], gpt_cond_len=30, max_ref_length=60)

    pause = torch.zeros(int(SR * 0.28))
    for i, scene in enumerate(scenes, 1):
        target = OUT / f"{i:02d}.wav"
        if (only and i not in only) or (not only and target.exists()):
            continue
        pieces = []
        for c in chunks(prepare(scene["narration"])):
            wav = model.inference(c, "ru", gpt_latent, spk_emb, temperature=0.65,
                                  repetition_penalty=5.0, top_p=0.85, enable_text_splitting=False)["wav"]
            pieces += [torch.as_tensor(wav).float(), pause]
        torchaudio.save(str(target), torch.cat(pieces[:-1]).unsqueeze(0), SR)
        print(f"{i:02d} готово", flush=True)


if __name__ == "__main__":
    main()
