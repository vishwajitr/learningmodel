"""
AI Influencer Studio – local AI service (FastAPI).

Hosts the Python-only engines behind a small HTTP API used by the Node server:
  * Text-to-speech: IndicF5 (AI4Bharat, voice cloning) and Meta MMS-TTS (hin/mar/eng)
  * Avatar animation / lip sync adapters: MuseTalk, SadTalker, Wav2Lip, LivePortrait

Nothing here fakes output. /health reports exactly which engines can run, and
generation endpoints return HTTP 503 with setup instructions when an engine
is missing.

Run:  uvicorn main:app --host 127.0.0.1 --port 8001
"""
from __future__ import annotations

import importlib.util
import io
import os
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

try:  # optional .env support
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass

app = FastAPI(title="AI Influencer Studio – AI service", version="0.1.0")


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


# --------------------------------------------------------------------------- GPU


def gpu_info() -> dict:
    if not has_module("torch"):
        return {"available": False, "devices": [], "backend": "torch not installed"}
    import torch  # noqa: WPS433

    if torch.cuda.is_available():
        return {
            "available": True,
            "backend": "cuda",
            "devices": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
        }
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return {"available": True, "backend": "mps", "devices": ["Apple Silicon (MPS)"]}
    return {"available": False, "backend": "cpu", "devices": []}


def torch_device() -> str:
    info = gpu_info()
    return info["backend"] if info["available"] else "cpu"


# --------------------------------------------------------------------------- engines status

TTS_SETUP = ["pip install -r requirements-tts.txt"]

ANIMATION_ENGINES = {
    "musetalk": {"env": "MUSETALK_DIR", "entry": "scripts/inference.py", "repo": "https://github.com/TMElyralab/MuseTalk"},
    "sadtalker": {"env": "SADTALKER_DIR", "entry": "inference.py", "repo": "https://github.com/OpenTalker/SadTalker"},
    "wav2lip": {"env": "WAV2LIP_DIR", "entry": "inference.py", "repo": "https://github.com/Rudrabha/Wav2Lip"},
    "liveportrait": {"env": "LIVEPORTRAIT_DIR", "entry": "inference.py", "repo": "https://github.com/KwaiVGI/LivePortrait"},
}


def tts_status() -> dict:
    base_ok = has_module("torch") and has_module("transformers") and has_module("numpy")
    missing = [m for m in ("torch", "transformers", "numpy", "soundfile") if not has_module(m)]
    mms = {
        "installed": base_ok,
        "ready": base_ok,
        "message": "MMS-TTS ready (models download on first use)" if base_ok else f"Missing packages: {', '.join(missing)}",
        "setup": [] if base_ok else TTS_SETUP,
        "languages": ["hi", "mr", "en"],
    }
    f5_ok = base_ok and has_module("soundfile") and (has_module("f5_tts") or has_module("indicf5"))
    indicf5 = {
        "installed": f5_ok,
        "ready": f5_ok,
        "message": "IndicF5 ready (needs a reference clip per voice)" if f5_ok else "IndicF5 dependencies not installed",
        "setup": []
        if f5_ok
        else [
            "pip install -r requirements-tts.txt",
            "Accept the licence at https://huggingface.co/ai4bharat/IndicF5 then: huggingface-cli login",
        ],
        "languages": ["hi", "mr", "en", "bn", "gu", "kn", "ml", "or", "pa", "ta", "te", "as"],
    }
    return {"mms": mms, "indicf5": indicf5}


def animation_status() -> dict:
    out = {}
    for name, info in ANIMATION_ENGINES.items():
        d = os.environ.get(info["env"], "")
        entry_ok = bool(d) and (Path(d) / info["entry"]).exists()
        custom_cmd = bool(os.environ.get(f"{name.upper()}_CMD"))
        installed = entry_ok or custom_cmd
        if name == "liveportrait" and installed and not os.environ.get("LIVEPORTRAIT_DRIVING_VIDEO"):
            installed = False
            message = "LivePortrait found but LIVEPORTRAIT_DRIVING_VIDEO is not set (it is driven by a reference motion video)"
        elif installed:
            message = f"{name} found at {d or 'custom command'}"
        elif d:
            message = f"{info['env']}={d} but {info['entry']} was not found"
        else:
            message = f"{info['env']} is not set"
        out[name] = {
            "installed": installed,
            "ready": installed,
            "message": message,
            "setup": [] if installed else [f"git clone {info['repo']} and install its requirements + weights", f"export {info['env']}=/path/to/{name}"],
        }
    return out


@app.get("/health")
def health():
    return {"ok": True, "gpu": gpu_info(), "engines": {**tts_status(), **animation_status()}}


# --------------------------------------------------------------------------- TTS


class TTSRequest(BaseModel):
    engine: Literal["mms", "indicf5"]
    text: str
    language: Literal["hi", "mr", "en"]
    speed: float = 1.0
    pitch: float = 0.0
    style: Optional[str] = None
    emotion: Optional[str] = None
    speaker: Optional[str] = None
    ref_audio_path: Optional[str] = None
    ref_text: Optional[str] = None


_models: dict = {}
_lock = threading.Lock()

MMS_MODELS = {"hi": "facebook/mms-tts-hin", "mr": "facebook/mms-tts-mar", "en": "facebook/mms-tts-eng"}


def wav_bytes(samples, sample_rate: int) -> bytes:
    import numpy as np

    data = np.asarray(samples, dtype=np.float32).flatten()
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    if peak > 1.0:
        data = data / peak
    pcm = (np.clip(data, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def pitch_shift(samples, sr: int, semitones: float):
    """Optional pitch shift (requires librosa). Returns input unchanged if unavailable."""
    if abs(semitones) < 0.5 or not has_module("librosa"):
        return samples
    import librosa

    return librosa.effects.pitch_shift(samples, sr=sr, n_steps=semitones)


def synth_mms(req: TTSRequest):
    import torch
    from transformers import AutoTokenizer, VitsModel

    name = MMS_MODELS[req.language]
    with _lock:
        if name not in _models:
            _models[name] = (VitsModel.from_pretrained(name).to(torch_device()), AutoTokenizer.from_pretrained(name))
    model, tok = _models[name]
    model.speaking_rate = max(0.5, min(2.0, req.speed))
    inputs = tok(req.text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        audio = model(**inputs).waveform[0].cpu().numpy()
    sr = model.config.sampling_rate
    return pitch_shift(audio, sr, req.pitch), sr


def synth_indicf5(req: TTSRequest):
    import numpy as np
    from transformers import AutoModel

    if not req.ref_audio_path or not Path(req.ref_audio_path).exists() or not req.ref_text:
        raise HTTPException(400, "IndicF5 needs ref_audio_path (existing file) and ref_text")
    with _lock:
        if "indicf5" not in _models:
            _models["indicf5"] = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
    model = _models["indicf5"]
    audio = model(req.text, ref_audio_path=req.ref_audio_path, ref_text=req.ref_text)
    audio = np.asarray(audio)
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    sr = 24000
    return pitch_shift(audio, sr, req.pitch), sr


@app.post("/tts")
def tts(req: TTSRequest):
    status = tts_status()[req.engine]
    if not status["installed"]:
        raise HTTPException(503, f"{req.engine} is not installed: {status['message']}")
    if not req.text.strip():
        raise HTTPException(400, "Empty text")
    started = time.time()
    samples, sr = synth_mms(req) if req.engine == "mms" else synth_indicf5(req)
    data = wav_bytes(samples, sr)
    duration = len(samples) / float(sr)
    return Response(
        content=data,
        media_type="audio/wav",
        headers={"x-duration-seconds": f"{duration:.3f}", "x-synthesis-seconds": f"{time.time() - started:.2f}"},
    )


# --------------------------------------------------------------------------- animation


class AnimateRequest(BaseModel):
    engine: Literal["musetalk", "sadtalker", "wav2lip", "liveportrait"]
    image_path: str
    audio_path: str
    output_path: str
    mode: Literal["human", "cartoon"] = "human"
    expression: Optional[str] = None


def newest_mp4(folder: Path) -> Optional[Path]:
    files = sorted(folder.rglob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def build_command(req: AnimateRequest, work: Path) -> tuple[list[str], Path, Optional[Path]]:
    """Returns (command, cwd, file_to_collect_or_None). Override any engine with <ENGINE>_CMD."""
    info = ANIMATION_ENGINES[req.engine]
    root = Path(os.environ.get(info["env"], "."))
    py = os.environ.get(f"{req.engine.upper()}_PYTHON", "python")
    fmt = {
        "image": req.image_path, "audio": req.audio_path, "output": req.output_path, "workdir": str(work),
        "python": py, "dir": str(root), "driving": os.environ.get("LIVEPORTRAIT_DRIVING_VIDEO", ""),
    }
    custom = os.environ.get(f"{req.engine.upper()}_CMD")
    if custom:
        return shlex.split(custom.format(**fmt)), root, None if "{output}" in custom else work

    if req.engine == "sadtalker":
        cmd = [py, "inference.py", "--driven_audio", req.audio_path, "--source_image", req.image_path,
               "--result_dir", str(work), "--preprocess", "full", "--enhancer", "gfpgan"]
        if req.mode == "human":
            cmd.append("--still")
        return cmd, root, work
    if req.engine == "wav2lip":
        ckpt = os.environ.get("WAV2LIP_CHECKPOINT", "checkpoints/wav2lip_gan.pth")
        return [py, "inference.py", "--checkpoint_path", ckpt, "--face", req.image_path, "--audio", req.audio_path,
                "--outfile", req.output_path], root, None
    if req.engine == "musetalk":
        cfg = work / "inference.yaml"
        cfg.write_text(f'task_0:\n  video_path: "{req.image_path}"\n  audio_path: "{req.audio_path}"\n', encoding="utf-8")
        version = os.environ.get("MUSETALK_VERSION", "v15")
        return [py, "-m", "scripts.inference", "--inference_config", str(cfg), "--result_dir", str(work),
                "--version", version], root, work
    # liveportrait: expression/head motion from a driving video; audio is muxed afterwards (no lip sync).
    return [py, "inference.py", "-s", req.image_path, "-d", fmt["driving"], "-o", str(work)], root, work


@app.post("/animate")
def animate(req: AnimateRequest):
    status = animation_status()[req.engine]
    if not status["installed"]:
        raise HTTPException(503, f"{req.engine} is not installed: {status['message']}")
    for p in (req.image_path, req.audio_path):
        if not Path(p).exists():
            raise HTTPException(400, f"File not found: {p}")
    with tempfile.TemporaryDirectory(prefix=f"{req.engine}-") as tmp:
        work = Path(tmp)
        cmd, cwd, collect = build_command(req, work)
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60 * 60)
        if proc.returncode != 0:
            raise HTTPException(500, f"{req.engine} failed (exit {proc.returncode}): {proc.stderr[-2000:]}")
        if collect is not None:
            produced = newest_mp4(collect)
            if not produced:
                raise HTTPException(500, f"{req.engine} finished but produced no mp4")
            if req.engine == "liveportrait" and shutil.which("ffmpeg"):
                subprocess.run(["ffmpeg", "-y", "-i", str(produced), "-i", req.audio_path, "-map", "0:v", "-map", "1:a",
                                "-c:v", "copy", "-c:a", "aac", "-shortest", req.output_path], check=True, capture_output=True)
            else:
                shutil.copyfile(produced, req.output_path)
    if not Path(req.output_path).exists():
        raise HTTPException(500, "No output video was written")
    return {"ok": True, "output_path": req.output_path}
