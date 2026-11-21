import os from 'node:os';
import { Router } from 'express';
import { z } from 'zod';
import type { DashboardStats, ProviderKind, SystemStatus } from '../../../shared/types.js';
import { config } from '../config.js';
import { repos } from '../db/repositories.js';
import { aiServiceHealth } from '../lib/aiService.js';
import { commandExists, run } from '../lib/exec.js';
import { notFound } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { cancelJob, retryJob } from '../services/jobQueue.js';
import { activeProviders, allStatuses, getModelConfig, providers, TEMPLATE_LLM_ID } from '../providers/registry.js';
import { influencerView } from '../services/views.js';

export const systemRouter = Router();

async function detectGpu(): Promise<SystemStatus['gpu']> {
  const health = await aiServiceHealth();
  if (health.gpu?.available) {
    return { available: true, source: `ai-service (${health.gpu.backend})`, devices: health.gpu.devices, message: 'GPU available to the AI service' };
  }
  try {
    const res = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeoutMs: 4000 });
    if (res.code === 0 && res.stdout.trim()) {
      return { available: true, source: 'nvidia-smi', devices: res.stdout.trim().split('\n'), message: 'NVIDIA GPU detected' };
    }
  } catch {
    /* not installed */
  }
  if (os.platform() === 'darwin' && os.arch() === 'arm64') {
    return { available: true, source: 'platform', devices: ['Apple Silicon (Metal / MPS)'], message: 'Apple Silicon – PyTorch MPS may be used by local models' };
  }
  return { available: false, source: 'none', devices: [], message: 'No GPU detected. Local image / video models will be slow or unavailable on CPU.' };
}

systemRouter.get(
  '/status',
  ah(async (_req, res) => {
    const [statuses, active, gpu, ffmpeg, health] = await Promise.all([
      allStatuses(),
      activeProviders(),
      detectGpu(),
      commandExists(config.ffmpegPath),
      aiServiceHealth(true),
    ]);
    const kinds: ProviderKind[] = ['llm', 'image', 'tts', 'animation', 'video'];
    const configurations = await Promise.all(kinds.map(getModelConfig));
    const body: SystemStatus = {
      providers: statuses,
      active,
      configurations,
      gpu,
      ffmpeg: { available: Boolean(ffmpeg), version: ffmpeg },
      aiService: { url: config.aiServiceUrl, reachable: health.reachable, message: health.message },
    };
    res.json(body);
  }),
);

systemRouter.put(
  '/config/:kind',
  ah(async (req, res) => {
    const kind = parse(z.enum(['llm', 'image', 'tts', 'animation', 'video']), req.params.kind);
    const { provider, settings } = parse(
      z.object({ provider: z.string(), settings: z.record(z.union([z.string(), z.number(), z.boolean()])).optional() }),
      req.body,
    );
    const valid = ['auto', ...providers[kind].map((p) => p.id), ...(kind === 'llm' ? [TEMPLATE_LLM_ID] : [])];
    if (!valid.includes(provider)) return res.status(400).json({ error: `Unknown provider "${provider}" for ${kind}. Valid: ${valid.join(', ')}` });
    const cfg = await getModelConfig(kind);
    res.json(await repos.modelConfigs.update(cfg.id, { provider, ...(settings ? { settings } : {}) }));
  }),
);

systemRouter.get(
  '/dashboard',
  ah(async (_req, res) => {
    const [influencers, scripts, screenplays, videos, drafts, projects, recentInf, activities, recentProjects] = await Promise.all([
      repos.influencers.count(),
      repos.scripts.count(),
      repos.screenplays.count(),
      repos.videos.count({ status: 'completed', kind: 'final' }).then(async (n) => n + (await repos.videos.count({ status: 'completed', kind: 'animatic' }))),
      repos.projects.count({ status: 'draft' }).then(async (n) => n + (await repos.projects.count({ status: 'in_progress' }))),
      repos.projects.count(),
      repos.influencers.list(undefined, { limit: 8 }),
      repos.activities.list(undefined, { limit: 12 }),
      repos.projects.list(undefined, { orderBy: 'updatedAt', limit: 5 }),
    ]);
    const body: DashboardStats = {
      totals: { influencers, scripts, screenplays, videos, draftProjects: drafts, projects },
      recentInfluencers: await Promise.all(recentInf.map(influencerView)),
      recentActivities: activities,
      recentProjects,
    };
    res.json(body);
  }),
);

export const jobsRouter = Router();

jobsRouter.get(
  '/',
  ah(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    if (ids.length) return res.json((await Promise.all(ids.map((id) => repos.jobs.get(id)))).filter(Boolean));
    res.json(await repos.jobs.list(undefined, { limit: Number(req.query.limit ?? 50) }));
  }),
);
jobsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const job = await repos.jobs.get(req.params.id);
    if (!job) throw notFound('Job');
    res.json(job);
  }),
);
jobsRouter.post('/:id/retry', ah(async (req, res) => res.json(await retryJob(req.params.id))));
jobsRouter.post('/:id/cancel', ah(async (req, res) => res.json(await cancelJob(req.params.id))));
