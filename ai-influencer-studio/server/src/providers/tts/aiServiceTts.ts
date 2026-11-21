import type { ProviderStatus } from '../../../../shared/types.js';
import { AI_SERVICE_SETUP, aiServiceHealth, aiServicePost } from '../../lib/aiService.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { TTSProvider, TTSRequest, TTSResult } from '../types.js';

const ENGINE_INFO: Record<string, { name: string; setup: string[] }> = {
  indicf5: {
    name: 'IndicF5 (AI4Bharat, local, voice cloning)',
    setup: [
      'pip install -r ai-service/requirements-tts.txt',
      'Accept the model licence at https://huggingface.co/ai4bharat/IndicF5 and run: huggingface-cli login',
      'IndicF5 clones a voice: upload a 5–10 s reference clip + its transcript on the voice profile.',
      'A CUDA GPU is strongly recommended (CPU works but is slow).',
    ],
  },
  mms: {
    name: 'Meta MMS-TTS (local, Hindi / Marathi / English)',
    setup: [
      'pip install -r ai-service/requirements-tts.txt',
      'Models download automatically on first use: facebook/mms-tts-hin, facebook/mms-tts-mar, facebook/mms-tts-eng',
      'Runs on CPU. Note: MMS-TTS models are licensed CC-BY-NC 4.0 (non-commercial).',
    ],
  },
};

/** TTS engines hosted by the Python ai-service (FastAPI). */
export class AIServiceTTS implements TTSProvider {
  readonly kind = 'tts' as const;
  readonly isDemo = false;
  readonly name: string;

  constructor(readonly id: 'indicf5' | 'mms') {
    this.name = ENGINE_INFO[id].name;
  }

  async status(): Promise<ProviderStatus> {
    const health = await aiServiceHealth();
    const base = { id: this.id, name: this.name, kind: 'tts' as const, isDemo: false };
    if (!health.reachable) {
      return {
        ...base,
        state: 'unreachable',
        message: health.message,
        setupInstructions: [...AI_SERVICE_SETUP, ...ENGINE_INFO[this.id].setup],
      };
    }
    const engine = health.engines[this.id];
    if (!engine?.installed) {
      return {
        ...base,
        state: 'not_installed',
        message: engine?.message ?? 'Engine dependencies not installed',
        setupInstructions: engine?.setup?.length ? engine.setup : ENGINE_INFO[this.id].setup,
      };
    }
    return { ...base, state: 'ready', message: engine.message, setupInstructions: [], details: { languages: engine.languages } };
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const st = await this.status();
    if (st.state !== 'ready') throw new ProviderUnavailableError(`${this.name}: ${st.message}`, st.setupInstructions, this.id);
    if (this.id === 'indicf5' && (!req.referenceAudioPath || !req.voice.referenceText)) {
      throw new HttpError(
        400,
        'IndicF5 needs a reference audio clip and its transcript on the voice profile (Voice Studio → edit voice).',
        'VOICE_REFERENCE_REQUIRED',
      );
    }
    const res = await aiServicePost(
      '/tts',
      {
        engine: this.id,
        text: req.text,
        language: req.language,
        speed: req.voice.speed,
        pitch: req.voice.pitch,
        style: req.voice.style,
        emotion: req.emotion ?? req.voice.emotion,
        speaker: req.voice.providerVoiceId || null,
        ref_audio_path: req.referenceAudioPath ?? null,
        ref_text: req.voice.referenceText || null,
      },
      15 * 60 * 1000,
    );
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 503) throw new ProviderUnavailableError(text, ENGINE_INFO[this.id].setup, this.id);
      throw new HttpError(502, `TTS failed (${res.status}): ${text}`, 'TTS_ERROR');
    }
    const duration = Number(res.headers.get('x-duration-seconds'));
    return { data: Buffer.from(await res.arrayBuffer()), ext: 'wav', durationSec: Number.isFinite(duration) ? duration : null };
  }
}
