import fs from 'node:fs';
import type { ProviderStatus } from '../../../../shared/types.js';
import { config } from '../../config.js';
import { fetchWithTimeout } from '../../lib/exec.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { ImageProvider, ImageRequest, ImageResult } from '../types.js';

const SETUP = [
  'Install Stable Diffusion WebUI (AUTOMATIC1111) or SD WebUI Forge: https://github.com/AUTOMATIC1111/stable-diffusion-webui',
  'Download a checkpoint (e.g. an SDXL photoreal model for human influencers, or a stylized/anime model for cartoons) into models/Stable-diffusion',
  'Launch with the API enabled: ./webui.sh --api --listen',
  'Set A1111_URL in .env if it is not http://127.0.0.1:7860',
  'For stronger identity consistency install the ControlNet extension with an IP-Adapter FaceID model (optional).',
];

/** Local Stable Diffusion via the AUTOMATIC1111 / Forge REST API. Uses img2img with the master reference for consistency. */
export class Automatic1111Image implements ImageProvider {
  readonly id = 'automatic1111';
  readonly name = 'Stable Diffusion WebUI (AUTOMATIC1111 / Forge)';
  readonly kind = 'image' as const;
  readonly isDemo = false;

  async status(): Promise<ProviderStatus> {
    const base = { id: this.id, name: this.name, kind: 'image' as const, isDemo: false };
    try {
      const res = await fetchWithTimeout(`${config.image.a1111Url}/sdapi/v1/sd-models`, {}, 1500);
      if (!res.ok) throw new Error(String(res.status));
      const models = (await res.json()) as { title: string }[];
      return {
        ...base,
        state: models.length ? 'ready' : 'not_installed',
        message: models.length ? `${models.length} checkpoint(s) available` : 'WebUI running but no checkpoints installed',
        setupInstructions: models.length ? [] : SETUP.slice(1, 2),
        details: { url: config.image.a1111Url, models: models.map((m) => m.title).slice(0, 10) },
      };
    } catch {
      return { ...base, state: 'unreachable', message: `Not reachable at ${config.image.a1111Url}`, setupInstructions: SETUP };
    }
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const useRef = req.referenceImagePath && fs.existsSync(req.referenceImagePath);
    const endpoint = useRef ? 'img2img' : 'txt2img';
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      width: Math.round(req.width / 8) * 8,
      height: Math.round(req.height / 8) * 8,
      steps: config.image.a1111Steps,
      cfg_scale: 6.5,
      seed,
      sampler_name: 'DPM++ 2M',
    };
    if (useRef) {
      body.init_images = [fs.readFileSync(req.referenceImagePath!).toString('base64')];
      body.denoising_strength = req.referenceStrength ?? 0.6;
      body.resize_mode = 1;
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${config.image.a1111Url}/sdapi/v1/${endpoint}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        15 * 60 * 1000,
      );
    } catch {
      throw new ProviderUnavailableError(`Stable Diffusion WebUI not reachable at ${config.image.a1111Url}`, SETUP, this.id);
    }
    if (!res.ok) throw new HttpError(502, `Stable Diffusion error ${res.status}: ${await res.text()}`, 'IMAGE_ERROR');
    const out = (await res.json()) as { images?: string[] };
    const b64 = out.images?.[0];
    if (!b64) throw new HttpError(502, 'Stable Diffusion returned no image', 'IMAGE_ERROR');
    return { data: Buffer.from(b64, 'base64'), ext: 'png', seed, isDemo: false };
  }
}
