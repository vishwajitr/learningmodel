import { Router } from 'express';
import { z } from 'zod';
import { SCRIPT_SECTIONS, VOICE_STYLES, type VoiceProfile } from '../../../shared/types.js';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ah, extFromMime, parse, upload } from '../lib/http.js';
import { deleteMedia, saveMedia } from '../lib/media.js';
import { enqueue } from '../services/jobQueue.js';

export const voicesRouter = Router();

const voiceSchema = z.object({
  name: z.string().trim().min(1, 'Voice name is required').max(80),
  gender: z.enum(['female', 'male', 'non_binary', 'other']),
  language: z.enum(['hi', 'en', 'mr']),
  accent: z.string().max(100).default(''),
  pitch: z.coerce.number().min(-12).max(12).default(0),
  speed: z.coerce.number().min(0.5).max(2).default(1),
  emotion: z.string().max(100).default(''),
  style: z.enum(VOICE_STYLES.map((s) => s.value) as [VoiceProfile['style'], ...VoiceProfile['style'][]]),
  provider: z.string().max(40).default('auto'),
  providerVoiceId: z.string().max(200).default(''),
  referenceText: z.string().max(2000).default(''),
  description: z.string().max(1000).default(''),
});

const SAMPLE_TEXT: Record<string, string> = {
  hi: 'नमस्ते दोस्तों! आज मैं आपको एक बहुत ही मज़ेदार चीज़ बताने वाली हूँ।',
  mr: 'नमस्कार मित्रांनो! आज मी तुम्हाला एक खूप भारी गोष्ट सांगणार आहे.',
  en: "Hey everyone! Today I'm going to tell you something really exciting.",
};

voicesRouter.get('/', ah(async (_req, res) => res.json(await repos.voices.list(undefined, { orderBy: 'name', direction: 'asc' }))));

voicesRouter.post(
  '/',
  ah(async (req, res) => {
    const data = parse(voiceSchema, req.body);
    const v = await repos.voices.create({ ...data, referenceAudioUrl: null, sampleAudioUrl: null });
    await logActivity('voice.created', 'voice', v.id, `Created voice profile ${v.name}`);
    res.status(201).json(v);
  }),
);

voicesRouter.put(
  '/:id',
  ah(async (req, res) => {
    const v = await repos.voices.update(req.params.id, parse(voiceSchema.partial(), req.body));
    if (!v) throw notFound('Voice profile');
    res.json(v);
  }),
);

voicesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const v = await repos.voices.get(req.params.id);
    if (!v) throw notFound('Voice profile');
    await repos.voices.delete(v.id);
    deleteMedia(v.referenceAudioUrl);
    res.status(204).end();
  }),
);

/** Upload a reference clip (needed by voice-cloning engines such as IndicF5). */
voicesRouter.post(
  '/:id/reference',
  upload.single('file'),
  ah(async (req, res) => {
    const v = await repos.voices.get(req.params.id);
    if (!v) throw notFound('Voice profile');
    if (!req.file || !req.file.mimetype.startsWith('audio/')) throw new HttpError(400, 'Upload an audio file (wav/mp3)');
    deleteMedia(v.referenceAudioUrl);
    const saved = saveMedia('uploads', extFromMime(req.file.mimetype, 'wav'), req.file.buffer);
    const updated = await repos.voices.update(v.id, {
      referenceAudioUrl: saved.url,
      ...(req.body.referenceText ? { referenceText: String(req.body.referenceText) } : {}),
    });
    res.json(updated);
  }),
);

/** Assign a voice profile to an influencer. */
voicesRouter.post(
  '/assign',
  ah(async (req, res) => {
    const { influencerId, voiceProfileId } = parse(z.object({ influencerId: z.string(), voiceProfileId: z.string().nullable() }), req.body);
    const inf = await repos.influencers.get(influencerId);
    if (!inf) throw notFound('Influencer');
    const voice = voiceProfileId ? await repos.voices.get(voiceProfileId) : null;
    if (voiceProfileId && !voice) throw notFound('Voice profile');
    await repos.influencers.update(inf.id, {
      voiceProfileId,
      ...(voice ? { pitch: voice.pitch, speakingSpeed: voice.speed, accent: voice.accent || inf.accent } : {}),
    });
    await logActivity('voice.assigned', 'influencer', inf.id, voice ? `Assigned voice ${voice.name} to ${inf.name}` : `Removed voice from ${inf.name}`);
    res.json({ ok: true });
  }),
);

/** Preview a voice: queues a real TTS job; fails visibly if no engine is installed. */
voicesRouter.post(
  '/:id/preview',
  ah(async (req, res) => {
    const v = await repos.voices.get(req.params.id);
    if (!v) throw notFound('Voice profile');
    const { text } = parse(z.object({ text: z.string().max(500).optional() }), req.body ?? {});
    const audio = await repos.audio.create({
      influencerId: null, voiceProfileId: v.id, scriptId: null, sceneId: null, projectId: null,
      text: text?.trim() || SAMPLE_TEXT[v.language], url: null, durationSec: null, provider: v.provider,
      status: 'pending', error: null, jobId: null,
    });
    const job = await enqueue('tts.generate', { audioIds: [audio.id] }, { message: `Voice preview: ${v.name}`, maxAttempts: 1 });
    await repos.audio.update(audio.id, { jobId: job.id });
    res.status(202).json({ job, audioId: audio.id });
  }),
);

const speechSchema = z.object({
  influencerId: z.string().optional(),
  voiceProfileId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  scriptId: z.string().optional(),
  screenplayId: z.string().optional(),
  sceneIds: z.array(z.string()).optional(),
  mode: z.enum(['script', 'scenes']).default('scenes'),
});

/** Generate speech for a whole script, or per scene of a screenplay. */
voicesRouter.post(
  '/speech',
  ah(async (req, res) => {
    const body = parse(speechSchema, req.body);
    let influencerId = body.influencerId ?? null;
    let scriptId = body.scriptId ?? null;
    const items: { text: string; sceneId: string | null }[] = [];

    if (body.mode === 'scenes') {
      if (!body.screenplayId) throw new HttpError(400, 'screenplayId is required for scene audio');
      const sp = await repos.screenplays.get(body.screenplayId);
      if (!sp) throw notFound('Screenplay');
      influencerId ??= sp.influencerId;
      scriptId ??= sp.scriptId;
      let scenes = await repos.scenes.list({ screenplayId: sp.id }, { orderBy: 'orderIndex', direction: 'asc' });
      if (body.sceneIds?.length) scenes = scenes.filter((s) => body.sceneIds!.includes(s.id));
      for (const s of scenes) if (s.dialogue.trim()) items.push({ text: s.dialogue.trim(), sceneId: s.id });
    } else {
      if (!scriptId) throw new HttpError(400, 'scriptId is required');
      const script = await repos.scripts.get(scriptId);
      if (!script) throw notFound('Script');
      influencerId ??= script.influencerId;
      items.push({ text: SCRIPT_SECTIONS.map((s) => script.sections[s.key]).filter(Boolean).join(' '), sceneId: null });
    }
    if (!items.length) throw new HttpError(400, 'There is no dialogue to synthesize');
    const inf = influencerId ? await repos.influencers.get(influencerId) : undefined;
    const voiceProfileId = body.voiceProfileId ?? inf?.voiceProfileId ?? null;
    if (!voiceProfileId) throw new HttpError(400, 'No voice profile: assign a voice to the influencer in Voice Studio first');
    const voice = await repos.voices.get(voiceProfileId);
    if (!voice) throw notFound('Voice profile');

    const audioIds: string[] = [];
    for (const it of items) {
      const a = await repos.audio.create({
        influencerId: inf?.id ?? null, voiceProfileId, scriptId, sceneId: it.sceneId, projectId: body.projectId ?? null,
        text: it.text, url: null, durationSec: null, provider: voice.provider, status: 'pending', error: null, jobId: null,
      });
      audioIds.push(a.id);
    }
    const job = await enqueue('tts.generate', { audioIds }, { message: `Speech for ${items.length} clip(s) – ${voice.name}`, maxAttempts: 2 });
    for (const id of audioIds) await repos.audio.update(id, { jobId: job.id });
    res.status(202).json({ job, audioIds });
  }),
);

voicesRouter.get(
  '/audio/list',
  ah(async (req, res) => {
    const filter: Record<string, string> = {};
    for (const key of ['projectId', 'scriptId', 'influencerId', 'voiceProfileId', 'sceneId']) {
      if (typeof req.query[key] === 'string') filter[key] = req.query[key] as string;
    }
    res.json(await repos.audio.list(filter, { limit: 200 }));
  }),
);

voicesRouter.delete(
  '/audio/:id',
  ah(async (req, res) => {
    const a = await repos.audio.get(req.params.id);
    if (!a) throw notFound('Audio');
    if (a.sceneId) {
      const scene = await repos.scenes.get(a.sceneId);
      if (scene?.audioId === a.id) await repos.scenes.update(scene.id, { audioId: null });
    }
    await repos.audio.delete(a.id);
    deleteMedia(a.url);
    res.status(204).end();
  }),
);
