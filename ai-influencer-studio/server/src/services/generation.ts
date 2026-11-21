import { defaultNegativePrompt, styleSuffix } from '../../../shared/promptTemplates.js';
import { ASPECT_RATIOS, type AspectRatio, type ImageKind, type Influencer } from '../../../shared/types.js';
import { config } from '../config.js';
import { logActivity, repos } from '../db/repositories.js';
import { HttpError, ProviderUnavailableError } from '../lib/errors.js';
import { ANIMATION_ENGINES } from '../providers/animation/aiServiceAnimation.js';
import { run } from '../lib/exec.js';
import { mediaUrlToPath, newMediaPath, saveMedia } from '../lib/media.js';
import { resolveAnimation, resolveImage, resolveTTS, resolveVideo } from '../providers/registry.js';
import { registerHandler } from './jobQueue.js';
import { sceneVisualPrompt } from './writers.js';

// ------------------------------------------------------------ prompt helpers

export function characterPrompt(inf: Influencer, opts: { outfit?: string } = {}): string {
  const base =
    inf.appearancePrompt.trim() ||
    `${inf.age}-year-old ${inf.ethnicity} ${inf.gender === 'female' ? 'woman' : inf.gender === 'male' ? 'man' : 'person'}, ${inf.appearance}`;
  return [base, `wearing ${opts.outfit || inf.clothingStyle}`].filter(Boolean).join(', ');
}

export function composeImagePrompt(inf: Influencer, parts: { template?: string; user?: string; outfit?: string; pose?: string; expression?: string }) {
  return [
    characterPrompt(inf, { outfit: parts.outfit }),
    parts.template,
    parts.pose,
    parts.expression ? `${parts.expression} facial expression` : '',
    parts.user,
    styleSuffix(inf.characterType, inf.cartoonStyle),
  ]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(', ');
}

export function composeNegativePrompt(inf: Influencer, extra = '') {
  return [inf.negativePrompt || defaultNegativePrompt(inf.characterType), extra].filter(Boolean).join(', ');
}

export async function probeDuration(file: string): Promise<number | null> {
  try {
    const res = await run(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeoutMs: 20000 });
    const d = parseFloat(res.stdout.trim());
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

async function masterReferencePath(inf: Influencer): Promise<string | null> {
  if (!inf.masterImageId) return null;
  const img = await repos.images.get(inf.masterImageId);
  // Placeholder art is not a useful identity reference for a real model.
  if (!img || img.isDemo) return null;
  return mediaUrlToPath(img.url);
}

// ------------------------------------------------------------ image.generate

export interface ImageJobPayload {
  influencerId: string;
  prompt: string;
  negativePrompt: string;
  kind: ImageKind;
  aspectRatio: AspectRatio;
  count: number;
  /** Explicit reference image URL (uploaded or from gallery). Falls back to the master reference. */
  referenceUrl: string | null;
  useMasterReference: boolean;
  referenceStrength: number;
  label?: string;
}

registerHandler('image.generate', async (job, ctx) => {
  const p = job.payload as unknown as ImageJobPayload;
  const inf = await repos.influencers.get(p.influencerId);
  if (!inf) throw new HttpError(404, 'Influencer not found');
  const provider = await resolveImage();
  const { width, height } = ASPECT_RATIOS[p.aspectRatio] ?? ASPECT_RATIOS['1:1'];
  const ref = p.referenceUrl ? mediaUrlToPath(p.referenceUrl) : p.useMasterReference ? await masterReferencePath(inf) : null;
  const ids: string[] = [];
  const count = Math.max(1, Math.min(4, p.count || 1));
  for (let i = 0; i < count; i++) {
    await ctx.progress(i / count, `Generating image ${i + 1} of ${count} with ${provider.name}`);
    const res = await provider.generate({
      prompt: p.prompt,
      negativePrompt: p.negativePrompt,
      width,
      height,
      seed: inf.seed !== null ? inf.seed + i : null,
      referenceImagePath: ref,
      referenceStrength: p.referenceStrength,
      characterType: inf.characterType,
      label: { seedKey: `${inf.id}-${job.id}-${i}`, title: inf.name, subtitle: p.label ?? p.kind },
    });
    const saved = saveMedia('images', res.ext, res.data);
    const img = await repos.images.create({
      influencerId: inf.id,
      url: saved.url,
      kind: p.kind,
      prompt: p.prompt,
      negativePrompt: p.negativePrompt,
      aspectRatio: p.aspectRatio,
      width,
      height,
      provider: provider.id,
      isDemo: res.isDemo,
      status: 'preview',
      seed: res.seed,

    });
    ids.push(img.id);
  }
  return { imageIds: ids, provider: provider.id, isDemo: provider.isDemo, usedReference: Boolean(ref) };
});

// ------------------------------------------------------------ scene.images

registerHandler('scene.images', async (job, ctx) => {
  const { screenplayId, sceneIds, overwrite } = job.payload as { screenplayId: string; sceneIds?: string[]; overwrite?: boolean };
  const sp = await repos.screenplays.get(screenplayId);
  if (!sp) throw new HttpError(404, 'Screenplay not found');
  if (!sp.influencerId) throw new HttpError(400, 'Assign an influencer to the screenplay before generating scene images');
  const inf = await repos.influencers.get(sp.influencerId);
  if (!inf) throw new HttpError(404, 'Influencer not found');
  const provider = await resolveImage();
  const ref = await masterReferencePath(inf);
  let scenes = await repos.scenes.list({ screenplayId }, { orderBy: 'orderIndex', direction: 'asc' });
  if (sceneIds?.length) scenes = scenes.filter((s) => sceneIds.includes(s.id));
  if (!overwrite) scenes = scenes.filter((s) => !s.thumbnailImageId);
  const { width, height } = ASPECT_RATIOS['9:16'];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    await ctx.progress(i / Math.max(1, scenes.length), `Scene ${s.orderIndex + 1}: generating image`);
    const prompt = s.visualPrompt || sceneVisualPrompt(inf, s);
    const res = await provider.generate({
      prompt,
      negativePrompt: composeNegativePrompt(inf),
      width,
      height,
      seed: inf.seed,
      referenceImagePath: ref,
      referenceStrength: 0.65,
      characterType: inf.characterType,
      label: { seedKey: inf.id, title: `Scene ${s.orderIndex + 1}`, subtitle: `${s.cameraAngle} · ${s.expression}`, caption: '' },
    });
    const saved = saveMedia('images', res.ext, res.data);
    const img = await repos.images.create({
      influencerId: inf.id, url: saved.url, kind: 'scene', prompt, negativePrompt: composeNegativePrompt(inf),
      aspectRatio: '9:16', width, height, provider: provider.id, isDemo: res.isDemo, status: 'saved', seed: res.seed,
    });
    await repos.scenes.update(s.id, { thumbnailImageId: img.id });
  }
  await logActivity('scene.images', 'screenplay', screenplayId, `Generated ${scenes.length} scene image(s) for "${sp.title}" (${provider.name})`);
  return { generated: scenes.length, provider: provider.id, isDemo: provider.isDemo };
});

// ------------------------------------------------------------ tts.generate

async function failAudio(ids: string[], error: string) {
  for (const id of ids) {
    const a = await repos.audio.get(id);
    if (a && a.status !== 'completed') await repos.audio.update(id, { status: 'failed', error });
  }
}

registerHandler(
  'tts.generate',
  async (job, ctx) => {
    const { audioIds } = job.payload as { audioIds: string[] };
    let done = 0;
    for (const id of audioIds) {
      const a = await repos.audio.get(id);
      if (!a || a.status === 'completed') continue;
      await repos.audio.update(id, { status: 'processing', error: null });
      const voice = a.voiceProfileId ? await repos.voices.get(a.voiceProfileId) : undefined;
      if (!voice) throw new HttpError(400, 'No voice profile assigned. Assign a voice in Voice Studio first.');
      const inf = a.influencerId ? await repos.influencers.get(a.influencerId) : undefined;
      const scene = a.sceneId ? await repos.scenes.get(a.sceneId) : undefined;
      const provider = await resolveTTS(voice.provider);
      await ctx.progress(done / audioIds.length, `Synthesizing ${scene ? `scene ${scene.orderIndex + 1}` : 'audio'} with ${provider.name}`);
      const res = await provider.synthesize({
        text: a.text,
        language: voice.language,
        voice,
        emotion: scene?.voiceEmotion || voice.emotion,
        characterType: inf?.characterType ?? 'human',
        referenceAudioPath: mediaUrlToPath(voice.referenceAudioUrl),
      });
      const saved = saveMedia('audio', res.ext, res.data);
      const duration = res.durationSec ?? (await probeDuration(saved.filePath));
      await repos.audio.update(id, { url: saved.url, durationSec: duration, status: 'completed', provider: provider.id, error: null });
      if (scene) await repos.scenes.update(scene.id, { audioId: id });
      done++;
    }
    await logActivity('tts', 'audio', audioIds[0] ?? null, `Generated ${done} audio clip(s)`);
    return { generated: done };
  },
  async (job, error) => failAudio((job.payload as { audioIds: string[] }).audioIds, error),
);

// ------------------------------------------------------------ video.animate

registerHandler(
  'video.animate',
  async (job, ctx) => {
    const { videoIds, engine } = job.payload as { videoIds: string[]; engine?: string };
    const provider = await resolveAnimation(engine);
    if (!provider) {
      throw new ProviderUnavailableError(
        'No avatar animation / lip-sync engine is installed. Scenes were not animated.',
        Object.values(ANIMATION_ENGINES).flatMap((e) => [`— ${e.name}`, ...e.setup.map((x) => `   ${x}`)]),
      );
    }
    let i = 0;
    for (const id of videoIds) {
      const v = await repos.videos.get(id);
      if (!v || !v.sceneId) continue;
      const scene = await repos.scenes.get(v.sceneId);
      if (!scene) continue;
      await repos.videos.update(id, { status: 'processing' });
      await ctx.progress(i / videoIds.length, `Animating scene ${scene.orderIndex + 1} with ${provider.name}`);
      const img = scene.thumbnailImageId ? await repos.images.get(scene.thumbnailImageId) : undefined;
      const audio = scene.audioId ? await repos.audio.get(scene.audioId) : undefined;
      const imagePath = mediaUrlToPath(img?.url);
      const audioPath = mediaUrlToPath(audio?.url);
      if (!imagePath || !audioPath) throw new HttpError(400, `Scene ${scene.orderIndex + 1} needs both an image and audio before animation`);
      const sp = await repos.screenplays.get(scene.screenplayId);
      const inf = sp?.influencerId ? await repos.influencers.get(sp.influencerId) : undefined;
      const out = newMediaPath('video', 'mp4');
      await provider.animate({ imagePath, audioPath, mode: inf?.characterType ?? 'human', expression: scene.expression, outputPath: out.filePath });
      await repos.videos.update(id, { status: 'completed', url: out.url, provider: provider.id, progress: 1 });
      i++;
    }
    return { animated: i };
  },
  async (job, error) => {
    for (const id of (job.payload as { videoIds: string[] }).videoIds) {
      const v = await repos.videos.get(id);
      if (v && v.status !== 'completed') await repos.videos.update(id, { status: 'failed', error });
    }
  },
);

// ------------------------------------------------------------ video.render

registerHandler(
  'video.render',
  async (job, ctx) => {
    const { projectId, videoId } = job.payload as { projectId: string; videoId: string };
    const project = await repos.projects.get(projectId);
    if (!project) throw new HttpError(404, 'Project not found');
    if (!project.screenplayId) throw new HttpError(400, 'Project has no screenplay');
    const scenes = await repos.scenes.list({ screenplayId: project.screenplayId }, { orderBy: 'orderIndex', direction: 'asc' });
    const sceneVideos = await repos.videos.list({ projectId, kind: 'scene', status: 'completed' });
    const video = await resolveVideo();
    await repos.videos.update(videoId, { status: 'processing' });
    await repos.projects.update(projectId, { status: 'rendering' });
    let animatedCount = 0;
    const renderScenes = await Promise.all(
      scenes.map(async (s) => {
        const sv = sceneVideos.find((v) => v.sceneId === s.id);
        if (sv) animatedCount++;
        const img = s.thumbnailImageId ? await repos.images.get(s.thumbnailImageId) : undefined;
        const audio = s.audioId ? await repos.audio.get(s.audioId) : undefined;
        return {
          imagePath: mediaUrlToPath(img?.url),
          videoPath: mediaUrlToPath(sv?.url),
          audioPath: audio?.status === 'completed' ? mediaUrlToPath(audio.url) : null,
          duration: s.duration,
          subtitle: s.subtitle || s.dialogue,
          cameraMovement: s.cameraMovement,
          transition: s.transition,
        };
      }),
    );
    const rs = project.reelSettings;
    const out = newMediaPath('video', 'mp4');
    const result = await video.render({
      scenes: renderScenes,
      width: rs.width,
      height: rs.height,
      fps: rs.fps,
      subtitles: rs.subtitles,
      burnSubtitles: rs.burnSubtitles,
      watermarkText: rs.watermarkText,
      introText: rs.introText,
      outroText: rs.outroText,
      backgroundMusicPath: mediaUrlToPath(rs.backgroundMusicUrl),
      musicVolume: rs.musicVolume,
      outputPath: out.filePath,
      onProgress: (p, m) => void ctx.progress(p, m).then(() => repos.videos.update(videoId, { progress: p })),
    });
    const withAudio = renderScenes.filter((s) => s.audioPath).length;
    const isAnimatic = animatedCount === 0;
    const notes = isAnimatic
      ? `Storyboard animatic: scene images with camera motion${withAudio ? ` and voice audio (${withAudio}/${scenes.length} scenes)` : ' (silent – no voice audio generated)'}. No AI animation or lip sync was applied.`
      : `${animatedCount}/${scenes.length} scenes animated with lip sync; the rest use still images.`;
    await repos.videos.update(videoId, {
      status: 'completed',
      url: out.url,
      progress: 1,
      kind: isAnimatic ? 'animatic' : 'final',
      isDemo: isAnimatic,
      notes,
    });
    await repos.projects.update(projectId, { finalVideoId: videoId, status: 'completed' });
    await logActivity('video.render', 'project', projectId, `Rendered ${isAnimatic ? 'animatic' : 'video'} for "${project.name}" (${result.durationSec.toFixed(1)}s)`);
    return { videoId, url: out.url, durationSec: result.durationSec, isAnimatic };
  },
  async (job, error) => {
    const { projectId, videoId } = job.payload as { projectId: string; videoId: string };
    await repos.videos.update(videoId, { status: 'failed', error });
    await repos.projects.update(projectId, { status: 'in_progress' });
  },
);
