import type { ModelConfiguration, ProviderKind, ProviderStatus } from '../../../shared/types.js';
import { config } from '../config.js';
import { repos } from '../db/repositories.js';
import { ProviderUnavailableError } from '../lib/errors.js';
import { AIServiceAnimation } from './animation/aiServiceAnimation.js';
import { Automatic1111Image } from './image/automatic1111.js';
import { PlaceholderImage } from './image/placeholder.js';
import { AnthropicLLM } from './llm/anthropic.js';
import { OllamaLLM } from './llm/ollama.js';
import { AIServiceTTS } from './tts/aiServiceTts.js';
import { EspeakTTS } from './tts/espeak.js';
import type {
  AvatarAnimationProvider, ImageProvider, LLMProvider, Provider, TTSProvider, VideoProvider,
} from './types.js';
import { FFmpegVideo } from './video/ffmpeg.js';

/** Pseudo-provider id for rule/template-based text generation (no AI). */
export const TEMPLATE_LLM_ID = 'template-demo';

export const providers = {
  llm: [new AnthropicLLM(), new OllamaLLM()] as LLMProvider[],
  image: [new Automatic1111Image(), new PlaceholderImage()] as ImageProvider[],
  tts: [new AIServiceTTS('indicf5'), new AIServiceTTS('mms'), new EspeakTTS()] as TTSProvider[],
  animation: [
    new AIServiceAnimation('musetalk'),
    new AIServiceAnimation('sadtalker'),
    new AIServiceAnimation('wav2lip'),
    new AIServiceAnimation('liveportrait'),
  ] as AvatarAnimationProvider[],
  video: [new FFmpegVideo()] as VideoProvider[],
};

const ENV_DEFAULTS: Record<ProviderKind, string> = {
  llm: config.llm.provider,
  image: config.image.provider,
  tts: config.tts.provider,
  animation: config.animation.provider,
  video: 'ffmpeg',
};

export async function getModelConfig(kind: ProviderKind): Promise<ModelConfiguration> {
  const [existing] = await repos.modelConfigs.list({ kind });
  if (existing) return existing;
  return repos.modelConfigs.create({ kind, provider: ENV_DEFAULTS[kind], settings: {} });
}

export async function templateLLMStatus(): Promise<ProviderStatus> {
  return {
    id: TEMPLATE_LLM_ID,
    name: 'Template writer (demo, no AI)',
    kind: 'llm',
    state: 'demo',
    isDemo: true,
    message: 'Fills built-in Hindi / English / Marathi templates. Output is clearly marked as demo content.',
    setupInstructions: [],
  };
}

export async function allStatuses(): Promise<ProviderStatus[]> {
  const list: Provider[] = [
    ...providers.llm, ...providers.image, ...providers.tts, ...providers.animation, ...providers.video,
  ];
  const statuses = await Promise.all(list.map((p) => p.status()));
  return [...statuses.slice(0, providers.llm.length), await templateLLMStatus(), ...statuses.slice(providers.llm.length)];
}

async function pick<T extends Provider>(kind: ProviderKind, list: T[]): Promise<T | null> {
  const cfg = await getModelConfig(kind);
  if (cfg.provider && cfg.provider !== 'auto') {
    return list.find((p) => p.id === cfg.provider) ?? null;
  }
  for (const p of list) {
    if (p.isDemo) continue;
    if ((await p.status()).state === 'ready') return p;
  }
  return null;
}

/** Returns the active LLM, or null when the template (demo) writer should be used. */
export async function resolveLLM(): Promise<LLMProvider | null> {
  const cfg = await getModelConfig('llm');
  if (cfg.provider === TEMPLATE_LLM_ID) return null;
  return pick('llm', providers.llm);
}

export async function resolveImage(): Promise<ImageProvider> {
  const p = await pick('image', providers.image);
  return p ?? providers.image.find((x) => x.isDemo)!;
}

export async function resolveTTS(preferred?: string | null): Promise<TTSProvider> {
  if (preferred && preferred !== 'auto') {
    const p = providers.tts.find((x) => x.id === preferred);
    if (p) return p;
  }
  const p = await pick('tts', providers.tts);
  if (p) return p;
  const statuses = await Promise.all(providers.tts.map((x) => x.status()));
  throw new ProviderUnavailableError(
    'No text-to-speech engine is installed. Audio was not generated.',
    statuses.flatMap((s) => [`— ${s.name}: ${s.message}`, ...s.setupInstructions.map((i) => `   ${i}`)]),
  );
}

export async function resolveAnimation(preferred?: string | null): Promise<AvatarAnimationProvider | null> {
  if (preferred && preferred !== 'auto' && preferred !== 'none') {
    return providers.animation.find((x) => x.id === preferred) ?? null;
  }
  if (preferred === 'none') return null;
  return pick('animation', providers.animation);
}

export async function resolveVideo(): Promise<VideoProvider> {
  return providers.video[0];
}

export async function activeProviders(): Promise<Record<ProviderKind, string | null>> {
  const llm = await resolveLLM();
  const image = await resolveImage();
  const tts = await pick('tts', providers.tts);
  const anim = await pick('animation', providers.animation);
  const video = await resolveVideo();
  return {
    llm: llm?.id ?? TEMPLATE_LLM_ID,
    image: image.id,
    tts: tts?.id ?? null,
    animation: anim?.id ?? null,
    video: (await video.status()).state === 'ready' ? video.id : null,
  };
}
