import { Router } from 'express';
import { z } from 'zod';
import { CONTENT_CATEGORIES, PLATFORMS, SCRIPT_SECTIONS, TONES, VIDEO_DURATIONS, type Script } from '../../../shared/types.js';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, parse } from '../lib/http.js';
import { rewriteSection, writeScreenplay, writeScript } from '../services/writers.js';
import { screenplayView } from '../services/views.js';

export const scriptsRouter = Router();

const sectionsSchema = z.object({
  hook: z.string().max(4000).default(''),
  intro: z.string().max(4000).default(''),
  main: z.string().max(12000).default(''),
  engagement: z.string().max(4000).default(''),
  cta: z.string().max(4000).default(''),
});

const briefSchema = z.object({
  influencerId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  topic: z.string().trim().min(3, 'Topic must be at least 3 characters').max(300),
  category: z.enum(CONTENT_CATEGORIES),
  language: z.enum(['hi', 'en', 'mr']),
  duration: z.coerce.number().refine((d) => (VIDEO_DURATIONS as readonly number[]).includes(d), 'Invalid duration'),
  tone: z.enum(TONES),
  targetAudience: z.string().max(300).default(''),
  platform: z.enum(PLATFORMS).default('Instagram Reels'),
  callToAction: z.string().max(300).default(''),
});

const scriptSchema = briefSchema.extend({
  title: z.string().trim().min(1).max(200),
  sections: sectionsSchema,
  status: z.enum(['draft', 'final']).default('draft'),
});

scriptsRouter.get(
  '/',
  ah(async (req, res) => {
    const influencerId = req.query.influencerId as string | undefined;
    res.json(await repos.scripts.list(influencerId ? { influencerId } : undefined, { orderBy: 'updatedAt' }));
  }),
);

scriptsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    res.json(s);
  }),
);

/** Generate a new script with the configured LLM (or the labelled demo template writer). */
scriptsRouter.post(
  '/generate',
  ah(async (req, res) => {
    const brief = parse(briefSchema, req.body);
    const inf = brief.influencerId ? await repos.influencers.get(brief.influencerId) : undefined;
    if (brief.influencerId && !inf) throw new HttpError(400, 'Influencer not found');
    const result = await writeScript(brief as Parameters<typeof writeScript>[0], inf ?? null);
    const script = await repos.scripts.create({
      ...(brief as Omit<Script, 'id' | 'createdAt' | 'updatedAt' | 'title' | 'sections' | 'status' | 'provider' | 'isDemo'>),
      title: result.value.title,
      sections: result.value.sections,
      status: 'draft',
      provider: result.provider,
      isDemo: result.isDemo,
    });
    await logActivity('script.generated', 'script', script.id, `Generated script "${script.title}"${result.isDemo ? ' (demo template)' : ` with ${result.provider}`}`);
    res.status(201).json(script);
  }),
);

scriptsRouter.post(
  '/',
  ah(async (req, res) => {
    const data = parse(scriptSchema, req.body);
    const script = await repos.scripts.create({ ...(data as Omit<Script, 'id' | 'createdAt' | 'updatedAt'>), provider: 'manual', isDemo: false });
    await logActivity('script.created', 'script', script.id, `Created script "${script.title}"`);
    res.status(201).json(script);
  }),
);

scriptsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const data = parse(scriptSchema.partial(), req.body);
    const s = await repos.scripts.update(req.params.id, data as Partial<Script>);
    if (!s) throw notFound('Script');
    res.json(s);
  }),
);

scriptsRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = s;
    const copy = await repos.scripts.create({ ...rest, title: `${s.title} (copy)`, status: 'draft', projectId: null });
    await logActivity('script.duplicated', 'script', copy.id, `Duplicated script "${s.title}"`);
    res.status(201).json(copy);
  }),
);

scriptsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    await repos.scripts.delete(s.id);
    await logActivity('script.deleted', 'script', null, `Deleted script "${s.title}"`);
    res.status(204).end();
  }),
);

scriptsRouter.post(
  '/:id/sections/:key/regenerate',
  ah(async (req, res) => {
    const key = parse(z.enum(['hook', 'intro', 'main', 'engagement', 'cta']), req.params.key);
    const { instructions } = parse(z.object({ instructions: z.string().max(500).default('') }), req.body ?? {});
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    const inf = s.influencerId ? await repos.influencers.get(s.influencerId) : undefined;
    const result = await rewriteSection(s, key, inf ?? null, instructions);
    const updated = await repos.scripts.update(s.id, {
      sections: { ...s.sections, [key]: result.value },
      // Once any part is demo text, the script is flagged as containing demo content.
      isDemo: s.isDemo || result.isDemo,
      provider: s.provider === 'manual' ? result.provider : s.provider,
    });
    res.json({ script: updated, provider: result.provider, isDemo: result.isDemo });
  }),
);

scriptsRouter.get(
  '/:id/export',
  ah(async (req, res) => {
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    const format = String(req.query.format ?? 'txt');
    const safe = s.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'script';
    if (format === 'json') {
      res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(safe)}.json"`);
      return res.json(s);
    }
    const md = format === 'md';
    const header = md
      ? `# ${s.title}\n\n**Topic:** ${s.topic}  \n**Language:** ${s.language} · **Duration:** ${s.duration}s · **Tone:** ${s.tone} · **Platform:** ${s.platform}\n${s.isDemo ? '\n> ⚠️ Contains demo template text (not AI generated)\n' : ''}\n`
      : `${s.title}\nTopic: ${s.topic} | Language: ${s.language} | ${s.duration}s | ${s.tone} | ${s.platform}\n${s.isDemo ? 'NOTE: contains demo template text (not AI generated)\n' : ''}\n`;
    const body = SCRIPT_SECTIONS.map((sec) => (md ? `## ${sec.label}\n\n${s.sections[sec.key]}\n` : `[${sec.label.toUpperCase()}]\n${s.sections[sec.key]}\n`)).join('\n');
    res.setHeader('content-type', md ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(safe)}.${md ? 'md' : 'txt'}"`);
    res.send(header + '\n' + body);
  }),
);

/** Convert a script into a scene-by-scene screenplay. */
scriptsRouter.post(
  '/:id/screenplay',
  ah(async (req, res) => {
    const s = await repos.scripts.get(req.params.id);
    if (!s) throw notFound('Script');
    const inf = s.influencerId ? await repos.influencers.get(s.influencerId) : undefined;
    const result = await writeScreenplay(s, inf ?? null);
    const sp = await repos.screenplays.create({
      title: `${s.title} – Screenplay`,
      scriptId: s.id,
      influencerId: s.influencerId,
      projectId: s.projectId,
      status: 'draft',
      provider: result.provider,
      isDemo: result.isDemo,
    });
    for (const [i, scene] of result.value.entries()) {
      await repos.scenes.create({ ...scene, screenplayId: sp.id, orderIndex: i, thumbnailImageId: null, audioId: null });
    }
    if (s.projectId) await repos.projects.update(s.projectId, { screenplayId: sp.id, status: 'in_progress' });
    await logActivity('screenplay.created', 'screenplay', sp.id, `Converted "${s.title}" into ${result.value.length} scenes (${result.provider})`);
    res.status(201).json(await screenplayView(sp));
  }),
);
