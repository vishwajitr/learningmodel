import type { CharacterType, Language, ProviderKind, ProviderStatus, VoiceProfile } from '../../../shared/types.js';

/**
 * Provider contracts. Every AI capability goes through one of these interfaces
 * so models can be swapped without touching routes or UI. A provider must
 * report its real status and throw ProviderUnavailableError instead of
 * returning fake output.
 */
export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
  /** True for template / placeholder providers that do not use an AI model. */
  readonly isDemo: boolean;
  status(): Promise<ProviderStatus>;
}

export interface LLMRequest {
  system: string;
  prompt: string;
  /** JSON schema the response must satisfy. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LLMProvider extends Provider {
  kind: 'llm';
  generateJSON<T>(req: LLMRequest): Promise<T>;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number | null;
  /** Absolute path of a reference image for character consistency (img2img / IP-Adapter). */
  referenceImagePath?: string | null;
  /** 0..1 – how far the result may drift from the reference. */
  referenceStrength?: number;
  characterType: CharacterType;
  /** Used by placeholder providers for labels. */
  label?: { title?: string; subtitle?: string; seedKey: string; caption?: string };
}

export interface ImageResult {
  data: Buffer;
  ext: 'png' | 'jpg' | 'webp';
  seed: number | null;
  isDemo: boolean;
}

export interface ImageProvider extends Provider {
  kind: 'image';
  generate(req: ImageRequest): Promise<ImageResult>;
}

export interface TTSRequest {
  text: string;
  language: Language;
  voice: VoiceProfile;
  emotion?: string;
  characterType: CharacterType;
  referenceAudioPath?: string | null;
}

export interface TTSResult {
  data: Buffer;
  ext: 'wav' | 'mp3';
  durationSec: number | null;
}

export interface TTSProvider extends Provider {
  kind: 'tts';
  synthesize(req: TTSRequest): Promise<TTSResult>;
}

export interface AnimationRequest {
  imagePath: string;
  audioPath: string;
  mode: CharacterType;
  expression?: string;
  outputPath: string;
}

export interface AvatarAnimationProvider extends Provider {
  kind: 'animation';
  animate(req: AnimationRequest): Promise<{ videoPath: string }>;
}

export interface RenderScene {
  imagePath: string | null;
  videoPath: string | null;
  audioPath: string | null;
  duration: number;
  subtitle: string;
  cameraMovement: string;
  transition: string;
}

export interface RenderRequest {
  scenes: RenderScene[];
  width: number;
  height: number;
  fps: number;
  burnSubtitles: boolean;
  subtitles: boolean;
  watermarkText: string;
  introText: string;
  outroText: string;
  backgroundMusicPath: string | null;
  musicVolume: number;
  outputPath: string;
  onProgress?: (p: number, message: string) => void;
}

export interface VideoProvider extends Provider {
  kind: 'video';
  render(req: RenderRequest): Promise<{ videoPath: string; durationSec: number }>;
}

export type AnyProvider = LLMProvider | ImageProvider | TTSProvider | AvatarAnimationProvider | VideoProvider;
