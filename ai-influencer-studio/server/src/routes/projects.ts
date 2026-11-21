import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_REEL_SETTINGS, type Project } from '../../../shared/types.js';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, extFromMime, parse, upload } from '../lib/http.js';
import { saveMedia } from '../lib/media.js';
import { enqueue } from '../services/jobQueue.js';
import { projectView } from '../services/views.js';
import { writeSocial } from '../services/writers.js';

export const projectsRouter = Router();

const reelSchema = z.object({
  fps: z.coerce.number().int().refine((n) => [24, 25, 30, 60].includes(n), 'FPS must be 24, 25, 30 or 60'),
  subtitles: z.boolean(),
  burnSubtitles: z.boolean(),
  backgroundMusicUrl: z.string().nullable(),
  musicVolume: z.coerce.number().min(0).max(1),
  watermarkText: z.string().max(60),
  introText: z.string().max(120),
  outroText: z.string().max(120),
});

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  description: z.string().max(2000).default(''),
  status: z.enum(['draft', 'in_progress', 'rendering', 'completed']).default('draft'),
  influencerId: z.string().nullable().default(null),
  scriptId: z.string().nullable().default(null),
  screenplayId: z.string().nullable().default(null),
  reelSettings: reelSchema.partial().optional(),
});

async function linkChildren(p: Project) {
  // Keep relationships consistent: the project's script / screenplay point back to it.
  if (p.scriptId) await repos.scripts.update(p.scriptId, { projectId: p.id });
  if (p.screenplayId) await repos.screenplays.update(p.screenplayId, { projectId: p.id });
}

projectsRouter.get(
  '/',
  ah(async (req, res) => {
    const status = req.query.status as Project['status'] | undefined;
    const list = await repos.projects.list(status ? { status } : undefined, { orderBy: 'updatedAt' });
    res.json(await Promise.all(list.map(projectView)));
  }),
);

projectsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    res.json(await projectView(p));
  }),
);

projectsRouter.post(
  '/',
  ah(async (req, res) => {
    const data = parse(projectSchema, req.body);
    const p = await repos.projects.create({
      ...data,
      finalVideoId: null,
      social: null,
      reelSettings: { ...DEFAULT_REEL_SETTINGS, ...data.reelSettings },
    });
    await linkChildren(p);
    await logActivity('project.created', 'project', p.id, `Created project "${p.name}"`);
    res.status(201).json(await projectView(p));
  }),
);

projectsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const existing = await repos.projects.get(req.params.id);
    if (!existing) throw notFound('Project');
    const data = parse(projectSchema.partial(), req.body);
    const { reelSettings, ...rest } = data;
    const p = await repos.projects.update(existing.id, {
      ...rest,
      ...(reelSettings ? { reelSettings: { ...existing.reelSettings, ...reelSettings } } : {}),
    } as Partial<Project>);
    await linkChildren(p!);
    res.json(await projectView(p!));
  }),
);

projectsRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const src = await repos.projects.get(req.params.id);
    if (!src) throw notFound('Project');
    const copy = await repos.projects.create({
      name: `${src.name} (copy)`, description: src.description, status: 'draft', influencerId: src.influencerId,
      scriptId: null, screenplayId: null, finalVideoId: null, reelSettings: src.reelSettings, social: src.social,
    });
    res.status(201).json(await projectView(copy));
  }),
);

projectsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    await repos.projects.delete(p.id);
    await logActivity('project.deleted', 'project', null, `Deleted project "${p.name}"`);
    res.status(204).end();
  }),
);

projectsRouter.post(
  '/:id/social',
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    if (!p.scriptId) throw new HttpError(400, 'Attach a script to the project first');
    const script = await repos.scripts.get(p.scriptId);
    if (!script) throw notFound('Script');
    const inf = p.influencerId ? await repos.influencers.get(p.influencerId) : undefined;
    const social = await writeSocial(script, inf ?? null);
    const updated = await repos.projects.update(p.id, { social });
    res.json(await projectView(updated!));
  }),
);

projectsRouter.put(
  '/:id/social',
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    const data = parse(
      z.object({
        title: z.string().max(200), caption: z.string().max(2200), hashtags: z.array(z.string().max(60)).max(30),
        description: z.string().max(2000), suggestedPostingTime: z.string().max(300),
      }),
      req.body,
    );
    const updated = await repos.projects.update(p.id, {
      social: { ...data, provider: p.social?.provider ?? 'manual', isDemo: p.social?.isDemo ?? false },
    });
    res.json(await projectView(updated!));
  }),
);

projectsRouter.post(
  '/:id/music',
  upload.single('file'),
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    if (!req.file || !req.file.mimetype.startsWith('audio/')) throw new HttpError(400, 'Upload an audio file');
    const saved = saveMedia('uploads', extFromMime(req.file.mimetype, 'mp3'), req.file.buffer);
    const updated = await repos.projects.update(p.id, { reelSettings: { ...p.reelSettings, backgroundMusicUrl: saved.url } });
    res.json(await projectView(updated!));
  }),
);

/** Queue animation (lip sync) for every scene that has an image and audio. */
projectsRouter.post(
  '/:id/animate',
  ah(async (req, res) => {
    const { engine } = parse(z.object({ engine: z.string().optional() }), req.body ?? {});
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    if (!p.screenplayId) throw new HttpError(400, 'Project has no screenplay');
    const scenes = await repos.scenes.list({ screenplayId: p.screenplayId }, { orderBy: 'orderIndex', direction: 'asc' });
    const ready = scenes.filter((s) => s.thumbnailImageId && s.audioId);
    if (!ready.length) throw new HttpError(400, 'Generate scene images and scene audio before animating');
    const videoIds: string[] = [];
    for (const s of ready) {
      const v = await repos.videos.create({
        projectId: p.id, sceneId: s.id, kind: 'scene', url: null, provider: engine ?? 'auto', status: 'pending',
        progress: 0, error: null, jobId: null, isDemo: false, notes: '',
      });
      videoIds.push(v.id);
    }
    const job = await enqueue('video.animate', { videoIds, engine }, { message: `Animate ${ready.length} scene(s)`, maxAttempts: 1 });
    for (const id of videoIds) await repos.videos.update(id, { jobId: job.id });
    res.status(202).json({ job, videoIds, skipped: scenes.length - ready.length });
  }),
);

projectsRouter.post(
  '/:id/render',
  ah(async (req, res) => {
    const p = await repos.projects.get(req.params.id);
    if (!p) throw notFound('Project');
    if (!p.screenplayId) throw new HttpError(400, 'Project has no screenplay');
    const sceneCount = await repos.scenes.count({ screenplayId: p.screenplayId });
    if (!sceneCount) throw new HttpError(400, 'The screenplay has no scenes');
    const v = await repos.videos.create({
      projectId: p.id, sceneId: null, kind: 'final', url: null, provider: 'ffmpeg', status: 'pending', progress: 0,
      error: null, jobId: null, isDemo: false, notes: '',
    });
    const job = await enqueue('video.render', { projectId: p.id, videoId: v.id }, { message: `Render "${p.name}"`, maxAttempts: 1 });
    await repos.videos.update(v.id, { jobId: job.id });
    res.status(202).json({ job, videoId: v.id });
  }),
);
