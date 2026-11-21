import type { ProviderStatus } from '../../../../shared/types.js';
import { placeholderPng } from '../../lib/placeholder.js';
import type { ImageProvider, ImageRequest, ImageResult } from '../types.js';

/** Draws labelled SVG placeholder art. Not an AI model – results are flagged isDemo. */
export class PlaceholderImage implements ImageProvider {
  readonly id = 'placeholder';
  readonly name = 'Placeholder art (demo, no AI)';
  readonly kind = 'image' as const;
  readonly isDemo = true;

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      name: this.name,
      kind: 'image',
      state: 'demo',
      isDemo: true,
      message: 'Draws labelled placeholder art so the workflow can be tested without an image model.',
      setupInstructions: [],
    };
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const data = await placeholderPng({
      seedKey: req.label?.seedKey ?? req.prompt,
      characterType: req.characterType,
      width: req.width,
      height: req.height,
      title: req.label?.title,
      subtitle: req.label?.subtitle,
      caption: req.label?.caption ?? req.prompt.slice(0, 220),
    });
    return { data, ext: 'png', seed: null, isDemo: true };
  }
}
