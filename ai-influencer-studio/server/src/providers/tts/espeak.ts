import type { ProviderStatus } from '../../../../shared/types.js';
import { config } from '../../config.js';
import fs from 'node:fs';
import { commandExists, run } from '../../lib/exec.js';
import { newMediaPath } from '../../lib/media.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { TTSProvider, TTSRequest, TTSResult } from '../types.js';

const SETUP = [
  'Install eSpeak NG (free, offline): sudo apt install espeak-ng   |   brew install espeak-ng   |   Windows: https://github.com/espeak-ng/espeak-ng/releases',
  'Set ESPEAK_PATH in .env if the binary is not on PATH.',
  'eSpeak NG sounds robotic – use it only to test the workflow. Use IndicF5 or MMS-TTS for natural speech.',
];

const VOICE: Record<string, string> = { hi: 'hi', mr: 'mr', en: 'en-in' };

/** Lightweight formant synthesizer – real TTS, but robotic. Good for testing timing/subtitles. */
export class EspeakTTS implements TTSProvider {
  readonly id = 'espeak';
  readonly name = 'eSpeak NG (basic offline TTS)';
  readonly kind = 'tts' as const;
  readonly isDemo = false;

  async status(): Promise<ProviderStatus> {
    const version = await commandExists(config.espeakPath, '--version');
    return {
      id: this.id,
      name: this.name,
      kind: 'tts',
      isDemo: false,
      state: version ? 'ready' : 'not_installed',
      message: version ? `${version} (robotic quality – for testing)` : 'espeak-ng binary not found',
      setupInstructions: version ? [] : SETUP,
    };
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    if (!(await commandExists(config.espeakPath, '--version'))) {
      throw new ProviderUnavailableError('espeak-ng is not installed', SETUP, this.id);
    }
    const cartoon = req.characterType === 'cartoon' || req.voice.style === 'cartoon_expressive';
    const wpm = Math.round(165 * (req.voice.speed || 1));
    const pitch = Math.max(0, Math.min(99, Math.round(50 + (req.voice.pitch || 0) * 3 + (cartoon ? 20 : 0))));
    const variant = req.voice.gender === 'female' ? '+f3' : '+m3';
    const tmp = newMediaPath('tmp', 'wav');
    const res = await run(
      config.espeakPath,
      ['-v', `${VOICE[req.language] ?? 'en'}${variant}`, '-s', String(wpm), '-p', String(pitch), '-w', tmp.filePath, req.text],
      { timeoutMs: 120000 },
    );
    if (res.code !== 0 || !fs.existsSync(tmp.filePath)) throw new HttpError(502, `espeak-ng failed: ${res.stderr}`, 'TTS_ERROR');
    const data = fs.readFileSync(tmp.filePath);
    fs.rmSync(tmp.filePath, { force: true });
    return { data, ext: 'wav', durationSec: null };
  }
}
