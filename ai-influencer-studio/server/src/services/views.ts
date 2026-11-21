import type { Influencer, InfluencerView, Project, ProjectView, Screenplay, ScreenplayView, Scene } from '../../../shared/types.js';
import { repos, type SceneRecord } from '../db/repositories.js';

export async function influencerView(inf: Influencer): Promise<InfluencerView> {
  const [profile, master, imageCount, scriptCount] = await Promise.all([
    inf.profileImageId ? repos.images.get(inf.profileImageId) : undefined,
    inf.masterImageId ? repos.images.get(inf.masterImageId) : undefined,
    repos.images.count({ influencerId: inf.id, status: 'saved' }),
    repos.scripts.count({ influencerId: inf.id }),
  ]);
  return {
    ...inf,
    profileImageUrl: profile?.url ?? master?.url ?? null,
    masterImageUrl: master?.url ?? null,
    imageCount,
    scriptCount,
  };
}

export async function sceneView(s: SceneRecord): Promise<Scene> {
  const [img, audio] = await Promise.all([
    s.thumbnailImageId ? repos.images.get(s.thumbnailImageId) : undefined,
    s.audioId ? repos.audio.get(s.audioId) : undefined,
  ]);
  return { ...s, thumbnailUrl: img?.url ?? null, audioUrl: audio?.status === 'completed' ? audio.url : null };
}

export async function screenplayView(sp: Screenplay): Promise<ScreenplayView> {
  const scenes = await Promise.all((await repos.scenes.list({ screenplayId: sp.id }, { orderBy: 'orderIndex', direction: 'asc' })).map(sceneView));
  return { ...sp, scenes, totalDuration: Math.round(scenes.reduce((a, s) => a + s.duration, 0) * 10) / 10 };
}

export async function projectView(p: Project): Promise<ProjectView> {
  const [inf, script, sp, audio, videos] = await Promise.all([
    p.influencerId ? repos.influencers.get(p.influencerId) : undefined,
    p.scriptId ? repos.scripts.get(p.scriptId) : undefined,
    p.screenplayId ? repos.screenplays.get(p.screenplayId) : undefined,
    repos.audio.list({ projectId: p.id }),
    repos.videos.list({ projectId: p.id }),
  ]);
  const screenplay = sp ? await screenplayView(sp) : null;
  return {
    ...p,
    influencer: inf ? await influencerView(inf) : null,
    script: script ?? null,
    screenplay,
    audio,
    videos,
    finalVideo: videos.find((v) => v.id === p.finalVideoId) ?? null,
    sceneImageCount: screenplay?.scenes.filter((s) => s.thumbnailImageId).length ?? 0,
  };
}
