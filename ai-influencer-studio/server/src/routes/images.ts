import { Router } from 'express';
import { z } from 'zod';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { deleteMedia } from '../lib/media.js';
import { PROMPT_TEMPLATES } from '../../../shared/promptTemplates.js';
import { composeImagePrompt, composeNegativePrompt, type ImageJobPayload } from '../services/generation.js';
import { enqueue } from '../services/jobQueue.js';

export const imagesRouter = Router();

const generateSchema = z.object({
  influencerId: z.string(),
  templateId: z.string().nullable().optional(),
  prompt: z.string().max(2000).default(''),
  pose: z.string().max(300).optional(),
  expression: z.string().max(300).optional(),
  outfit: z.string().max(300).optional(),
  kind: z.enum(['profile', 'portrait', 'full_body', 'pose', 'expression', 'outfit', 'scene', 'upload', 'reference']).default('portrait'),
  aspectRatio: z.enum(['1:1', '9:16', '16:9', '3:4']).default('1:1'),
  count: z.coerce.number().int().min(1).max(4).default(1),
  referenceImageId: z.string().nullable().optional(),
  useMasterReference: z.boolean().default(true),
  referenceStrength: z.coerce.number().min(0.1).max(1).default(0.6),
  negativePrompt: z.string().max(1000).default(''),
  /** If true, the prompt is sent as-is without the character prefix. */
  rawPrompt: z.boolean().default(false),
});

/** Preview the exact prompt that will be sent to the image model. */
imagesRouter.post(
  '/compose',
  ah(async (req, res) => {
    const body = parse(generateSchema, req.body);
    const inf = await repos.influencers.get(body.influencerId);
    if (!inf) throw notFound('Influencer');
    const template = PROMPT_TEMPLATES.find((t) => t.id === body.templateId);
    const prompt = body.rawPrompt
      ? body.prompt
      : composeImagePrompt(inf, { template: template?.prompt, user: body.prompt, outfit: body.outfit, pose: body.pose, expression: body.expression });
    res.json({ prompt, negativePrompt: composeNegativePrompt(inf, body.negativePrompt) });
  }),
);

imagesRouter.post(
  '/generate',
  ah(async (req, res) => {
    const body = parse(generateSchema, req.body);
    const inf = await repos.influencers.get(body.influencerId);
    if (!inf) throw notFound('Influencer');
    const template = PROMPT_TEMPLATES.find((t) => t.id === body.templateId);
    if (!body.prompt.trim() && !template && !body.pose && !body.expression && !body.outfit && !body.rawPrompt) {
      throw new HttpError(400, 'Enter a prompt or choose a template / pose / expression / outfit');
    }
    let referenceUrl: string | null = null;
    if (body.referenceImageId) {
      const ref = await repos.images.get(body.referenceImageId);
      if (!ref) throw new HttpError(400, 'Reference image not found');
      referenceUrl = ref.url;
    }
    const payload: ImageJobPayload = {
      influencerId: inf.id,
      prompt: body.rawPrompt
        ? body.prompt
        : composeImagePrompt(inf, { template: template?.prompt, user: body.prompt, outfit: body.outfit, pose: body.pose, expression: body.expression }),
      negativePrompt: composeNegativePrompt(inf, body.negativePrompt),
      kind: body.kind,
      aspectRatio: body.aspectRatio,
      count: body.count,
      referenceUrl,
      useMasterReference: body.useMasterReference,
      referenceStrength: body.referenceStrength,
      label: template?.label ?? body.pose ?? body.expression ?? body.outfit ?? body.kind,
    };
    const job = await enqueue('image.generate', payload as unknown as Record<string, unknown>, { message: `Image generation for ${inf.name}` });
    res.status(202).json(job);
  }),
);

imagesRouter.get(
  '/',
  ah(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    const images = await Promise.all(ids.map((id) => repos.images.get(id)));
    res.json(images.filter(Boolean));
  }),
);

imagesRouter.post(
  '/:id/save',
  ah(async (req, res) => {
    const img = await repos.images.update(req.params.id, { status: 'saved' });
    if (!img) throw notFound('Image');
    const inf = await repos.influencers.get(img.influencerId);
    // The first saved image becomes the master reference + profile picture automatically.
    if (inf && !inf.masterImageId) await repos.influencers.update(inf.id, { masterImageId: img.id, profileImageId: inf.profileImageId ?? img.id });
    await logActivity('image.saved', 'influencer', img.influencerId, `Saved ${img.kind} image to ${inf?.name ?? 'influencer'}'s gallery`);
    res.json(img);
  }),
);

imagesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const img = await repos.images.get(req.params.id);
    if (!img) throw notFound('Image');
    const inf = await repos.influencers.get(img.influencerId);
    if (inf?.masterImageId === img.id) throw new HttpError(409, 'This is the master reference image. Choose another master before deleting it.');
    if (inf?.profileImageId === img.id) await repos.influencers.update(inf.id, { profileImageId: null });
    await repos.images.delete(img.id);
    deleteMedia(img.url);
    res.status(204).end();
  }),
);
