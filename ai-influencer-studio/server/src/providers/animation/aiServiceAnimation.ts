import fs from 'node:fs';
import type { ProviderStatus } from '../../../../shared/types.js';
import { AI_SERVICE_SETUP, aiServiceHealth, aiServicePost } from '../../lib/aiService.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { AnimationRequest, AvatarAnimationProvider } from '../types.js';

export type AnimationEngine = 'musetalk' | 'liveportrait' | 'sadtalker' | 'wav2lip';

export const ANIMATION_ENGINES: Record<AnimationEngine, { name: string; bestFor: string; setup: string[] }> = {
  musetalk: {
    name: 'MuseTalk (real-time lip sync)',
    bestFor: 'Human talking heads – high quality audio-driven lip sync',
    setup: [
      'git clone https://github.com/TMElyralab/MuseTalk and follow its README to download weights',
      'Set MUSETALK_DIR=/path/to/MuseTalk for the ai-service (see ai-service/.env.example)',
      'Requires an NVIDIA GPU (≥ 8 GB VRAM recommended).',
    ],
  },
  liveportrait: {
    name: 'LivePortrait (expressions & head motion)',
    bestFor: 'Facial expressions and head movement for humans and cartoons',
    setup: [
      'git clone https://github.com/KwaiVGI/LivePortrait and download its pretrained weights',
      'Set LIVEPORTRAIT_DIR=/path/to/LivePortrait for the ai-service',
      'LivePortrait is driven by a reference video; pair it with a lip-sync engine for speech.',
    ],
  },
  sadtalker: {
    name: 'SadTalker (single image → talking head)',
    bestFor: 'Talking heads with head pose from one image (human & stylized cartoon faces)',
    setup: [
      'git clone https://github.com/OpenTalker/SadTalker and run scripts/download_models.sh',
      'Set SADTALKER_DIR=/path/to/SadTalker for the ai-service',
      'GPU recommended; CPU works but is very slow.',
    ],
  },
  wav2lip: {
    name: 'Wav2Lip (lip sync on existing video/image)',
    bestFor: 'Robust lip sync, good fallback for cartoon characters',
    setup: [
      'git clone https://github.com/Rudrabha/Wav2Lip and download wav2lip_gan.pth into checkpoints/',
      'Set WAV2LIP_DIR=/path/to/Wav2Lip for the ai-service',
    ],
  },
};

/** Talking-head / lip-sync engines run by the Python ai-service. */
export class AIServiceAnimation implements AvatarAnimationProvider {
  readonly kind = 'animation' as const;
  readonly isDemo = false;
  readonly name: string;

  constructor(readonly id: AnimationEngine) {
    this.name = ANIMATION_ENGINES[id].name;
  }

  async status(): Promise<ProviderStatus> {
    const info = ANIMATION_ENGINES[this.id];
    const health = await aiServiceHealth();
    const base = { id: this.id, name: this.name, kind: 'animation' as const, isDemo: false, details: { bestFor: info.bestFor } };
    if (!health.reachable) {
      return { ...base, state: 'unreachable', message: health.message, setupInstructions: [...AI_SERVICE_SETUP, ...info.setup] };
    }
    const engine = health.engines[this.id];
    if (!engine?.installed) {
      return { ...base, state: 'not_installed', message: engine?.message ?? 'Not installed', setupInstructions: info.setup };
    }
    return { ...base, state: 'ready', message: engine.message, setupInstructions: [] };
  }

  async animate(req: AnimationRequest): Promise<{ videoPath: string }> {
    const st = await this.status();
    if (st.state !== 'ready') throw new ProviderUnavailableError(`${this.name}: ${st.message}`, st.setupInstructions, this.id);
    const res = await aiServicePost(
      '/animate',
      {
        engine: this.id,
        image_path: req.imagePath,
        audio_path: req.audioPath,
        output_path: req.outputPath,
        mode: req.mode,
        expression: req.expression ?? null,
      },
      60 * 60 * 1000,
    );
    if (!res.ok) throw new HttpError(502, `Animation failed (${res.status}): ${await res.text()}`, 'ANIMATION_ERROR');
    if (!fs.existsSync(req.outputPath)) throw new HttpError(502, 'Animation engine reported success but no video was written', 'ANIMATION_ERROR');
    return { videoPath: req.outputPath };
  }
}
