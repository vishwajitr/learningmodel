import { Router } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { defaultNegativePrompt } from '../../../shared/promptTemplates.js';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, parse, upload } from '../lib/http.js';
import { deleteMedia, saveMedia } from '../lib/media.js';
import { characterPrompt } from '../services/generation.js';
import { influencerView } from '../services/views.js';

export const influencerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  characterType: z.enum(['human', 'cartoon']),
  cartoonStyle: z.enum(['2d', '3d', 'anime', 'stylized_3d', 'illustration']).nullable().default(null),
  gender: z.enum(['female', 'male', 'non_binary', 'other']),
  age: z.coerce.number().int().min(1).max(120),
  ethnicity: z.string().max(80).default(''),
  personality: z.string().max(1000).default(''),
  appearance: z.string().max(2000).default(''),
  clothingStyle: z.string().max(500).default(''),
  languages: z.array(z.enum(['hi', 'en', 'mr'])).min(1, 'Select at least one language'),
  primaryLanguage: z.enum(['hi', 'en', 'mr']),
  speakingStyle: z.string().max(500).default(''),
  voiceProfileId: z.string().nullable().default(null),
  accent: z.string().max(100).default(''),
  pitch: z.coerce.number().min(-12).max(12).default(0),
  speakingSpeed: z.coerce.number().min(0.5).max(2).default(1),
  backgroundStory: z.string().max(4000).default(''),
  niches: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  appearancePrompt: z.string().max(2000).default(''),
  negativePrompt: z.string().max(1000).default(''),
  seed: z.coerce.number().int().min(0).max(2 ** 31).nullable().default(null),
});

export const influencersRouter = Router();

influencersRouter.get(
  '/',
  ah(async (req, res) => {
    const type = req.query.type as string | undefined;
    const list = await repos.influencers.list(type === 'human' || type === 'cartoon' ? { characterType: type } : undefined);
    res.json(await Promise.all(list.map(influencerView)));
  }),
);

influencersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const inf = await repos.influencers.get(req.params.id);
    if (!inf) throw notFound('Influencer');
    res.json(await influencerView(inf));
  }),
);

influencersRouter.post(
  '/',
  ah(async (req, res) => {
    const data = parse(influencerSchema, req.body);
    if (!data.languages.includes(data.primaryLanguage)) data.languages.unshift(data.primaryLanguage);
    if (data.characterType === 'human') data.cartoonStyle = null;
    else data.cartoonStyle ??= '3d';
    const draft = { ...data, profileImageId: null, masterImageId: null, isDefault: false };
    if (!draft.negativePrompt) draft.negativePrompt = defaultNegativePrompt(draft.characterType);
    const inf = await repos.influencers.create(draft);
    if (!inf.appearancePrompt) await repos.influencers.update(inf.id, { appearancePrompt: characterPrompt(inf).replace(/, wearing .*/, '') });
    await logActivity('influencer.created', 'influencer', inf.id, `Created influencer ${inf.name}`);
    res.status(201).json(await influencerView((await repos.influencers.get(inf.id))!));
  }),
);

influencersRouter.put(
  '/:id',
  ah(async (req, res) => {
    const existing = await repos.influencers.get(req.params.id);
    if (!existing) throw notFound('Influencer');
    const data = parse(influencerSchema.partial(), req.body);
    if (data.characterType === 'human') data.cartoonStyle = null;
    const inf = await repos.influencers.update(existing.id, data);
    await logActivity('influencer.updated', 'influencer', existing.id, `Updated influencer ${inf!.name}`);
    res.json(await influencerView(inf!));
  }),
);

influencersRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const src = await repos.influencers.get(req.params.id);
    if (!src) throw notFound('Influencer');
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
    const copy = await repos.influencers.create({ ...rest, name: `${src.name} (copy)`, isDefault: false, profileImageId: null, masterImageId: null });
    // Copy the master + profile image records so the duplicate keeps its look.
    for (const [field, imageId] of [['masterImageId', src.masterImageId], ['profileImageId', src.profileImageId]] as const) {
      if (!imageId) continue;
      const img = await repos.images.get(imageId);
      if (!img) continue;
      const { id: _i, createdAt: _ic, ...imgRest } = img;
      const dup = await repos.images.create({ ...imgRest, influencerId: copy.id });
      await repos.influencers.update(copy.id, { [field]: dup.id });
      if (src.masterImageId === src.profileImageId) {
        await repos.influencers.update(copy.id, { masterImageId: dup.id, profileImageId: dup.id });
        break;
      }
    }
    await logActivity('influencer.duplicated', 'influencer', copy.id, `Duplicated ${src.name}`);
    res.status(201).json(await influencerView((await repos.influencers.get(copy.id))!));
  }),
);

influencersRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const inf = await repos.influencers.get(req.params.id);
    if (!inf) throw notFound('Influencer');
    const images = await repos.images.list({ influencerId: inf.id });
    await repos.influencers.delete(inf.id);
    images.forEach((i) => deleteMedia(i.url));
    await logActivity('influencer.deleted', 'influencer', null, `Deleted influencer ${inf.name}`);
    res.status(204).end();
  }),
);

influencersRouter.get(
  '/:id/images',
  ah(async (req, res) => {
    const status = req.query.status as 'saved' | 'preview' | undefined;
    res.json(await repos.images.list({ influencerId: req.params.id, ...(status ? { status } : {}) }));
  }),
);

async function setImageField(influencerId: string, imageId: string, field: 'masterImageId' | 'profileImageId') {
  const img = await repos.images.get(imageId);
  if (!img || img.influencerId !== influencerId) throw new HttpError(400, 'Image does not belong to this influencer');
  if (img.status !== 'saved') await repos.images.update(img.id, { status: 'saved' });
  const inf = await repos.influencers.update(influencerId, { [field]: imageId });
  if (!inf) throw notFound('Influencer');
  return inf;
}

influencersRouter.post(
  '/:id/master',
  ah(async (req, res) => {
    const { imageId } = parse(z.object({ imageId: z.string() }), req.body);
    const inf = await setImageField(req.params.id, imageId, 'masterImageId');
    await logActivity('influencer.master', 'influencer', inf.id, `Set new master reference image for ${inf.name}`);
    res.json(await influencerView(inf));
  }),
);

influencersRouter.post(
  '/:id/profile',
  ah(async (req, res) => {
    const { imageId } = parse(z.object({ imageId: z.string() }), req.body);
    const inf = await setImageField(req.params.id, imageId, 'profileImageId');
    res.json(await influencerView(inf));
  }),
);

/** Upload a replacement profile / reference image. */
influencersRouter.post(
  '/:id/upload',
  upload.single('file'),
  ah(async (req, res) => {
    const inf = await repos.influencers.get(req.params.id);
    if (!inf) throw notFound('Influencer');
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    if (!req.file.mimetype.startsWith('image/')) throw new HttpError(400, 'Only image files are allowed');
    const role = String(req.body.role ?? 'gallery'); // gallery | master | profile
    const png = await sharp(req.file.buffer).rotate().png().toBuffer();
    const meta = await sharp(png).metadata();
    const saved = saveMedia('uploads', 'png', png);
    const img = await repos.images.create({
      influencerId: inf.id, url: saved.url, kind: role === 'gallery' ? 'upload' : 'reference', prompt: 'Uploaded by user',
      negativePrompt: '', aspectRatio: '1:1', width: meta.width ?? 0, height: meta.height ?? 0, provider: 'upload',
      isDemo: false, status: 'saved', seed: null,
    });
    if (role === 'master') await repos.influencers.update(inf.id, { masterImageId: img.id });
    if (role === 'profile' || role === 'master') await repos.influencers.update(inf.id, { profileImageId: img.id });
    await logActivity('image.uploaded', 'influencer', inf.id, `Uploaded ${role} image for ${inf.name}`);
    res.status(201).json(img);
  }),
);
