import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');

// Load the root .env too (server/.env takes precedence because dotenv/config ran first).
const rootEnv = path.join(projectRoot, '.env');
if (fs.existsSync(rootEnv)) {
  const { config: loadEnv } = await import('dotenv');
  loadEnv({ path: rootEnv });
}

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR ?? 'data');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  dataDir,
  dbPath: path.join(dataDir, 'studio.sqlite'),
  mediaDir: path.join(dataDir, 'media'),
  llm: {
    provider: process.env.LLM_PROVIDER ?? 'auto',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
  },
  image: {
    provider: process.env.IMAGE_PROVIDER ?? 'auto',
    a1111Url: (process.env.A1111_URL ?? 'http://127.0.0.1:7860').replace(/\/$/, ''),
    a1111Steps: Number(process.env.A1111_STEPS ?? 28),
  },
  tts: {
    provider: process.env.TTS_PROVIDER ?? 'auto',
  },
  animation: {
    provider: process.env.ANIMATION_PROVIDER ?? 'auto',
  },
  aiServiceUrl: (process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, ''),
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  espeakPath: process.env.ESPEAK_PATH ?? 'espeak-ng',
  subtitleFont: process.env.SUBTITLE_FONT ?? 'Noto Sans Devanagari',
};

for (const dir of [config.dataDir, config.mediaDir]) fs.mkdirSync(dir, { recursive: true });
