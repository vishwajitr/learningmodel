# AI Influencer Studio

Create AI Instagram influencers, write natural Hindi / English / Marathi reel scripts, turn them into scene-by-scene storyboards, give each influencer a voice, and render 9:16 reels, all on your own machine.

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn-style components (Radix) + Lucide · Node.js (Express, TypeScript) · SQLite (`node:sqlite`) behind a repository layer · optional Python FastAPI service for local AI models · FFmpeg.

> **Honesty rule:** nothing is faked. Every AI capability goes through a provider that reports its real status. If no model is installed, the UI says so and shows setup steps. Template- or placeholder-based output is always stored with `isDemo = true` and shown with a **Demo / Placeholder / Rule-based (no AI)** badge.

---

## Quick start

Requirements: **Node.js ≥ 22.13** (for built-in `node:sqlite`), **FFmpeg**. Optional: Python 3.10+ for local TTS and lip sync.

```bash
cd ai-influencer-studio
cp .env.example .env          # optional – works with defaults
npm install
npm run dev                   # API on :8787, web app on :5173
```

Open <http://localhost:5173>. On first start the server creates `data/studio.sqlite` and installs:

- **Aanya**: default realistic human influencer (Indian, 25, Hindi + English + Marathi, lifestyle and technology).
- **Tara**: default cartoon influencer (original stylized-3D Indian character, 24, lifestyle and entertainment).
- Four voice profiles, and a sample project ("3 AI apps that save time") with a Hindi script and a six-scene storyboard.

The default profile pictures are procedurally drawn placeholders, labelled `PLACEHOLDER`. Replace them by uploading an image on the influencer page, or by generating one in the Image Studio and clicking **Set master**.

Production build (one process serves the API and the built UI):

```bash
npm run build && npm start    # http://127.0.0.1:8787
```

Reset all data (deletes the database and media; defaults are re-installed on next start):

```bash
npm run seed:reset
```

---

## Connecting AI engines

The app runs without any AI engine installed. Each engine you add switches the matching feature from demo mode to real generation. **Settings → Models** shows live status, GPU detection and setup steps for every provider, and lets you pin a provider or leave it on *Auto*.

| Capability | Interface | Providers (in *Auto* order) | Free / local? |
|---|---|---|---|
| Scripts, screenplays, captions | `LLMProvider` | `anthropic` (Claude), `ollama`, then the `template-demo` fallback | Ollama: yes · Claude: API key |
| Images | `ImageProvider` | `automatic1111` (SD WebUI / Forge API), then the `placeholder` fallback | yes |
| Voice | `TTSProvider` | `indicf5`, `mms` (via AI service), `espeak` | yes |
| Talking head / lip sync | `AvatarAnimationProvider` | `musetalk`, `sadtalker`, `wav2lip`, `liveportrait` (via AI service) | yes (GPU recommended) |
| Video composition | `VideoProvider` | `ffmpeg` | yes |

### 1. Language model

- **Ollama (free, local):** install from <https://ollama.com>, then run `ollama pull llama3.1:8b` and `ollama serve`. For better Hindi/Marathi, try `qwen2.5:14b` or larger and set `OLLAMA_MODEL`.
- **Claude:** set `ANTHROPIC_API_KEY` in `.env` (server side only). The default model is `claude-opus-5-5`, with structured JSON output and server-side refusal fallback.
- With neither, the **template writer** fills fixed Hindi/English/Marathi lines and marks the script *Demo template (no AI)*. Screenplay conversion then uses a deterministic **rule-based** sentence splitter, labelled as such.

### 2. Images: Stable Diffusion WebUI

Install [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or Forge, add a checkpoint (an SDXL photoreal model for humans, a stylized model for cartoons) and start it with `--api`.

Character consistency works like this:

- Every prompt starts with the influencer's saved **master appearance prompt** and clothing, then the style suffix (photoreal or cartoon style).
- When a non-placeholder **master reference image** exists, generation uses **img2img** from it. Reference strength is adjustable.
- An optional fixed **seed** per influencer.
- Scene images reuse the same master reference and prompt.

### 3. Voice and lip sync: the Python AI service

```bash
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # FastAPI core
pip install -r requirements-tts.txt        # PyTorch, transformers, IndicF5
cp .env.example .env                       # paths to animation engines
uvicorn main:app --host 127.0.0.1 --port 8001
```

- **IndicF5** (AI4Bharat) clones a voice from a 5–10 s reference clip plus its transcript. Upload both on the voice profile (Voice Studio → Reference). You must accept the model licence on Hugging Face and run `huggingface-cli login`.
- **MMS-TTS** (Meta) has Hindi, Marathi and English voices with no reference clip needed. It runs on CPU. Licence: CC-BY-NC 4.0.
- **eSpeak NG** (`apt install espeak-ng` / `brew install espeak-ng`) needs no Python. It sounds robotic, so it's only good for testing timing.
- **MuseTalk / SadTalker / Wav2Lip / LivePortrait:** clone each repo, download its weights, and set `MUSETALK_DIR`, `SADTALKER_DIR`, etc. in `ai-service/.env`. Each engine's command line can be overridden with `<ENGINE>_CMD`, because their CLIs change between versions. LivePortrait animates expressions from a driving video, so it adds no lip sync.

Cartoon influencers get the `cartoon_expressive` voice style (higher pitch, faster) and the cartoon animation mode. Human influencers get natural voices and talking-head mode.

---

## Workflow

1. **Influencers:** create, edit, duplicate or delete human and cartoon characters, upload images, and set the master reference or profile picture.
2. **Image Studio:** generate from a prompt or a template, with pose, expression and outfit presets, 1:1 / 9:16 / 16:9 / 3:4, 1–4 variations, an uploaded reference and a strength slider. Preview the exact prompt, review previews, then save to the gallery.
3. **Script Studio:** pick an influencer, topic, category, language, duration, tone, audience, platform and CTA. The script comes out as Hook → Introduction → Main → Engagement → CTA. You can edit it, regenerate a single section (with instructions), save a draft, duplicate it, export it (.txt/.md/.json) or convert it to a screenplay.
4. **Screenplay Studio:** a storyboard of scene cards with drag-and-drop reordering. Add, edit, regenerate or delete scenes, change expression, camera, background and duration, generate scene images, and preview the whole thing in a player with subtitles and audio.
5. **Voice Studio:** voice profiles (name, gender, language, accent, pitch, speed, emotion, style, engine). Assign voices to influencers, preview them, generate whole-script or per-scene speech, then play, download, regenerate or delete the audio.
6. **Video Studio / Projects:** a 10-step pipeline per project:
   1. Influencer
   2. Script
   3. Screenplay
   4. Voice
   5. Scene images
   6. Animation
   7. Lip sync
   8. Combine
   9. Subtitles
   10. Export as 1080×1920, 30 fps MP4

   If no animation engine is installed, the render is labelled a **storyboard animatic**: still images with camera motion, voice audio and burned-in subtitles, and no lip sync. Reel settings cover subtitles (burned or soft track plus `.srt`), watermark, intro/outro cards and background music. The Publishing tab generates the caption, hashtags, title, description and a suggested posting time.

Long-running work (images, TTS, animation, rendering) runs through a persistent **job queue**. It tracks progress, retries transient errors automatically, has a manual **Retry** button, and resumes after a server restart. A missing engine fails the job immediately with setup instructions; it is never retried silently or faked.

---

## Project structure

```
ai-influencer-studio/
├── shared/                 # Types + prompt templates shared by server and client
├── server/src/
│   ├── index.ts            # Express app, static /media, job queue start
│   ├── config.ts           # Env-based configuration
│   ├── db/                 # schema.ts, repository.ts (storage-agnostic), repositories.ts, seed.ts, reset.ts
│   ├── providers/          # types.ts (LLM/Image/TTS/Animation/Video interfaces), registry.ts
│   │   ├── llm/            # anthropic.ts, ollama.ts
│   │   ├── image/          # automatic1111.ts, placeholder.ts
│   │   ├── tts/            # aiServiceTts.ts (IndicF5, MMS), espeak.ts
│   │   ├── animation/      # aiServiceAnimation.ts (MuseTalk, SadTalker, Wav2Lip, LivePortrait)
│   │   └── video/          # ffmpeg.ts (9:16 compositor)
│   ├── services/           # writers.ts (LLM prompts), templates.ts (demo), generation.ts (job handlers), jobQueue.ts, views.ts
│   ├── routes/             # influencers, images, scripts, screenplays, voices, projects, system/jobs
│   └── lib/                # errors, http, media storage, exec, placeholder art, AI-service client
├── client/src/
│   ├── components/         # ui/ (shadcn-style), layout/, common.tsx, InfluencerForm, ImageGrid
│   ├── lib/                # api.ts, hooks.ts (React Query), utils
│   └── pages/              # Dashboard, Influencers, InfluencerDetail, ImageStudio, ScriptStudio,
│                           # ScreenplayStudio, VoiceStudio, VideoStudio, Projects, ProjectDetail, Settings
├── ai-service/             # FastAPI: /health, /tts, /animate
└── data/                   # (git-ignored) studio.sqlite + media/{images,uploads,audio,video}
```

### Database

The entities are `Influencer`, `VoiceProfile`, `InfluencerImage`, `Script`, `Screenplay`, `Scene`, `Project`, `GeneratedAudio`, `GeneratedVideo` and `ModelConfiguration`, plus `Job` and `Activity`. All have timestamps and foreign keys: cascading deletes for owned children, `SET NULL` for references.

Routes and services only use the async `Repository<T>` interface in `server/src/db/repository.ts`. To move to MongoDB, implement that interface with a `MongoRepository` and swap the instances in `repositories.ts`.

### Adding a provider

Implement the interface in `server/src/providers/types.ts`. A provider must return a real `status()` and throw `ProviderUnavailableError` when it can't run. Then add it to the matching list in `providers/registry.ts`. It shows up automatically in Settings and in *Auto* selection.

---

## Roadmap

| Phase | Scope | State |
|---|---|---|
| 1 | Dashboard, influencers and defaults, image gallery, Script Studio, Screenplay Studio, persistence | Done |
| 2 | Voice Studio, local TTS (IndicF5 / MMS / eSpeak), assignment, previews, downloads | Done. eSpeak tested end to end here; IndicF5 and MMS are implemented but not run here (see notes) |
| 3 | Lip sync and animation adapters, FFmpeg rendering, subtitles, music, watermark | FFmpeg rendering done and tested. Animation adapters implemented but not run here (need GPU + weights) |
| 4 | Content calendar, video library, publishing integration | Not started (publishing copy generator is in place) |

### Known limitations

- IndicF5, MMS-TTS and the four animation engines are integrated through `ai-service/` but were not run in the build environment: it has no GPU and no PyTorch. Their command lines follow each project's README and may need `<ENGINE>_CMD` overrides.
- Scene transitions are rendered as fades. Cross-dissolves between clips (`xfade`) are not implemented yet.
- The demo template writer doesn't understand topics. Connect Ollama or Claude for real scripts.
