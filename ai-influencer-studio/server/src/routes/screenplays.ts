import { Router } from 'express';
import { z } from 'zod';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { enqueue } from '../services/jobQueue.js';
import { sceneView, screenplayView } from '../services/views.js';
import { rewriteScene, sceneVisualPrompt } from '../services/writers.js';

export const screenplaysRouter = Router();

const sceneSchema = z.object({
  duration: z.coerce.number().min(0.5).max(120),
  description: z.string().max(2000),
  action: z.string().max(2000),
  expression: z.string().max(200),
  bodyLanguage: z.string().max(500),
  cameraAngle: z.string().max(200),
  cameraMovement: z.string().max(200),
  background: z.string().max(500),
  dialogue: z.string().max(4000),
  voiceEmotion: z.string().max(200),
  subtitle: z.string().max(1000),
  visualPrompt: z.string().max(4000),
  transition: z.string().max(100),
});

screenplaysRouter.get(
  '/',
  ah(async (req, res) => {
    const influencerId = req.query.influencerId as string | undefined;
    const list = await repos.screenplays.list(influencerId ? { influencerId } : undefined, { orderBy: 'updatedAt' });
    res.json(await Promise.all(list.map(screenplayView)));
  }),
);

screenplaysRouter.get(
  '/:id',
  ah(async (req, res) => {
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    res.json(await screenplayView(sp));
  }),
);

screenplaysRouter.post(
  '/',
  ah(async (req, res) => {
    const data = parse(
      z.object({ title: z.string().trim().min(1).max(200), influencerId: z.string().nullable().default(null), projectId: z.string().nullable().default(null) }),
      req.body,
    );
    const sp = await repos.screenplays.create({ ...data, scriptId: null, status: 'draft', provider: 'manual', isDemo: false });
    await logActivity('screenplay.created', 'screenplay', sp.id, `Created screenplay "${sp.title}"`);
    res.status(201).json(await screenplayView(sp));
  }),
);

screenplaysRouter.put(
  '/:id',
  ah(async (req, res) => {
    const data = parse(
      z.object({ title: z.string().trim().min(1).max(200), influencerId: z.string().nullable(), status: z.enum(['draft', 'final']) }).partial(),
      req.body,
    );
    const sp = await repos.screenplays.update(req.params.id, data);
    if (!sp) throw notFound('Screenplay');
    res.json(await screenplayView(sp));
  }),
);

screenplaysRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = sp;
    const copy = await repos.screenplays.create({ ...rest, title: `${sp.title} (copy)`, projectId: null });
    for (const s of await repos.scenes.list({ screenplayId: sp.id })) {
      const { id: _si, createdAt: _sc, updatedAt: _su, ...sr } = s;
      await repos.scenes.create({ ...sr, screenplayId: copy.id, audioId: null });
    }
    res.status(201).json(await screenplayView(copy));
  }),
);

screenplaysRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    await repos.screenplays.delete(sp.id);
    await logActivity('screenplay.deleted', 'screenplay', null, `Deleted screenplay "${sp.title}"`);
    res.status(204).end();
  }),
);

screenplaysRouter.post(
  '/:id/scenes',
  ah(async (req, res) => {
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    const inf = sp.influencerId ? await repos.influencers.get(sp.influencerId) : undefined;
    const partial = parse(sceneSchema.partial(), req.body ?? {});
    const count = await repos.scenes.count({ screenplayId: sp.id });
    const base = {
      duration: 4, description: 'New scene', action: 'Talks to the camera', expression: 'Friendly', bodyLanguage: 'Relaxed, open posture',
      cameraAngle: 'Medium shot', cameraMovement: 'Static', background: 'Cozy home studio with soft lighting', dialogue: '',
      voiceEmotion: 'Conversational', subtitle: '', transition: 'Cut', ...partial,
    };
    const scene = await repos.scenes.create({
      ...base,
      visualPrompt: partial.visualPrompt ?? sceneVisualPrompt(inf ?? null, base),
      screenplayId: sp.id,
      orderIndex: count,
      thumbnailImageId: null,
      audioId: null,
    });
    await repos.screenplays.update(sp.id, {});
    res.status(201).json(await sceneView(scene));
  }),
);

screenplaysRouter.put(
  '/scenes/:sceneId',
  ah(async (req, res) => {
    const data = parse(sceneSchema.partial().extend({ refreshVisualPrompt: z.boolean().optional() }), req.body);
    const existing = await repos.scenes.get(req.params.sceneId);
    if (!existing) throw notFound('Scene');
    const { refreshVisualPrompt, ...patch } = data;
    if (refreshVisualPrompt) {
      const sp = await repos.screenplays.get(existing.screenplayId);
      const inf = sp?.influencerId ? await repos.influencers.get(sp.influencerId) : undefined;
      patch.visualPrompt = sceneVisualPrompt(inf ?? null, { ...existing, ...patch });
    }
    // Dialogue changed → previously generated audio no longer matches.
    const audioStale = patch.dialogue !== undefined && patch.dialogue !== existing.dialogue;
    const scene = await repos.scenes.update(existing.id, { ...patch, ...(audioStale ? { audioId: null } : {}) });
    await repos.screenplays.update(existing.screenplayId, {});
    res.json(await sceneView(scene!));
  }),
);

screenplaysRouter.delete(
  '/scenes/:sceneId',
  ah(async (req, res) => {
    const scene = await repos.scenes.get(req.params.sceneId);
    if (!scene) throw notFound('Scene');
    await repos.scenes.delete(scene.id);
    const rest = await repos.scenes.list({ screenplayId: scene.screenplayId }, { orderBy: 'orderIndex', direction: 'asc' });
    for (const [i, s] of rest.entries()) if (s.orderIndex !== i) await repos.scenes.update(s.id, { orderIndex: i });
    res.status(204).end();
  }),
);

screenplaysRouter.post(
  '/:id/reorder',
  ah(async (req, res) => {
    const { sceneIds } = parse(z.object({ sceneIds: z.array(z.string()).min(1) }), req.body);
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    const scenes = await repos.scenes.list({ screenplayId: sp.id });
    if (scenes.length !== sceneIds.length || !scenes.every((s) => sceneIds.includes(s.id))) {
      throw new HttpError(400, 'sceneIds must contain every scene of the screenplay exactly once');
    }
    for (const [i, id] of sceneIds.entries()) await repos.scenes.update(id, { orderIndex: i });
    await repos.screenplays.update(sp.id, {});
    res.json(await screenplayView(sp));
  }),
);

screenplaysRouter.post(
  '/scenes/:sceneId/regenerate',
  ah(async (req, res) => {
    const { instructions } = parse(z.object({ instructions: z.string().max(500).default('') }), req.body ?? {});
    const scene = await repos.scenes.get(req.params.sceneId);
    if (!scene) throw notFound('Scene');
    const sp = await repos.screenplays.get(scene.screenplayId);
    const script = sp?.scriptId ? await repos.scripts.get(sp.scriptId) : undefined;
    const inf = sp?.influencerId ? await repos.influencers.get(sp.influencerId) : undefined;
    const result = await rewriteScene(await sceneView(scene), script ?? null, inf ?? null, instructions);
    const patch = { ...result.value } as Record<string, unknown>;
    if (patch.duration !== undefined) patch.duration = Math.max(1, Number(patch.duration) || scene.duration);
    const updated = await repos.scenes.update(scene.id, patch);
    if (sp && result.isDemo && !sp.isDemo) await repos.screenplays.update(sp.id, { isDemo: true });
    res.json({ scene: await sceneView(updated!), provider: result.provider, isDemo: result.isDemo });
  }),
);

screenplaysRouter.post(
  '/:id/images',
  ah(async (req, res) => {
    const { sceneIds, overwrite } = parse(z.object({ sceneIds: z.array(z.string()).optional(), overwrite: z.boolean().default(false) }), req.body ?? {});
    const sp = await repos.screenplays.get(req.params.id);
    if (!sp) throw notFound('Screenplay');
    if (!sp.influencerId) throw new HttpError(400, 'Assign an influencer to this screenplay first');
    const job = await enqueue('scene.images', { screenplayId: sp.id, sceneIds, overwrite }, { message: `Scene images for "${sp.title}"` });
    res.status(202).json(job);
  }),
);
