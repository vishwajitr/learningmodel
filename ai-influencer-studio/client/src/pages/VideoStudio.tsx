import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AudioLines, Check, Clapperboard, Download, FileText, Film, Images, Layers, Mic2, Play, Sparkles, Subtitles, User, Wand2,
} from 'lucide-react';
import type { Job, ProjectView } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useJob, useProject, useProjects, useSystemStatus } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState, InfluencerAvatar, JobProgress, LoadingBlock, PageHeader, ProviderStateBadge, SetupInstructions } from '@/components/common';
import { StoryboardPlayer } from '@/pages/ScreenplayStudio';
import { cn, downloadUrl } from '@/lib/utils';

function Step({ n, title, icon, done, children, warn }: { n: number; title: string; icon: ReactNode; done: boolean; children: ReactNode; warn?: boolean }) {
  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold [&_svg]:size-4',
            done ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : warn ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'bg-muted text-muted-foreground',
          )}
        >
          {done ? <Check /> : icon}
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className="text-sm font-semibold"><span className="text-muted-foreground">{n}.</span> {title}</p>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function ProjectPipeline({ project }: { project: ProjectView }) {
  const qc = useQueryClient();
  const { data: status } = useSystemStatus();
  const [imagesJob, setImagesJob] = useState<string | null>(null);
  const [audioJob, setAudioJob] = useState<string | null>(null);
  const [animJob, setAnimJob] = useState<string | null>(null);
  const [renderJob, setRenderJob] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const keys = [qk.project(project.id), qk.projects, ['audio']];
  const jImages = useJob(imagesJob, { invalidate: keys });
  const jAudio = useJob(audioJob, { invalidate: keys });
  const jAnim = useJob(animJob, { invalidate: keys });
  const jRender = useJob(renderJob, { invalidate: keys });
  useEffect(() => {
    // Resume progress display for a render that is already running.
    const pending = project.videos.find((v) => v.kind !== 'scene' && (v.status === 'pending' || v.status === 'processing'));
    if (pending?.jobId && !renderJob) setRenderJob(pending.jobId);
  }, [project.videos, renderJob]);

  const scenes = project.screenplay?.scenes ?? [];
  const withAudio = scenes.filter((s) => s.audioUrl).length;
  const withImages = scenes.filter((s) => s.thumbnailUrl).length;
  const animated = new Set(project.videos.filter((v) => v.kind === 'scene' && v.status === 'completed').map((v) => v.sceneId)).size;
  const human = project.influencer?.characterType !== 'cartoon';
  const animProviders = status?.providers.filter((p) => p.kind === 'animation') ?? [];
  const animReady = animProviders.some((p) => p.state === 'ready');
  const ffmpeg = status?.providers.find((p) => p.id === 'ffmpeg');
  const final = project.finalVideo;

  const genImages = useApiMutation(() => api.post<Job>(`/screenplays/${project.screenplayId}/images`, { overwrite: false }), { onSuccess: (j) => setImagesJob(j.id) });
  const genAudio = useApiMutation(
    () => api.post<{ job: Job }>('/voices/speech', { mode: 'scenes', screenplayId: project.screenplayId, influencerId: project.influencerId, projectId: project.id }),
    { onSuccess: (r) => setAudioJob(r.job.id) },
  );
  const animate = useApiMutation(() => api.post<{ job: Job }>(`/projects/${project.id}/animate`, {}), { onSuccess: (r) => setAnimJob(r.job.id) });
  const render = useApiMutation(() => api.post<{ job: Job }>(`/projects/${project.id}/render`), {
    onSuccess: (r) => { setRenderJob(r.job.id); qc.invalidateQueries({ queryKey: qk.project(project.id) }); },
  });

  const busy = (j?: Job) => Boolean(j && (j.status === 'queued' || j.status === 'running'));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Generation pipeline</CardTitle>
          <CardDescription>
            Mode: {human ? 'Realistic human — talking-head animation, audio-driven lip sync, facial expressions, basic body movement' : 'Cartoon — animated talking character, cartoon lip sync, expressions and character movement'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Step n={1} title="Select influencer" icon={<User />} done={Boolean(project.influencer)}>
            {project.influencer ? (
              <div className="flex items-center gap-2"><InfluencerAvatar influencer={project.influencer} size={24} /> {project.influencer.name} <Badge variant="outline">{project.influencer.characterType}</Badge></div>
            ) : <Link to={`/projects/${project.id}`} className="text-violet-300 hover:underline">Choose an influencer in the project</Link>}
          </Step>
          <Step n={2} title="Select script" icon={<FileText />} done={Boolean(project.script)}>
            {project.script ? <Link to={`/scripts/${project.script.id}`} className="text-violet-300 hover:underline">{project.script.title}</Link> : <Link to={`/scripts?new=1&influencer=${project.influencerId ?? ''}&project=${project.id}`} className="text-violet-300 hover:underline">Write a script for this project</Link>}
          </Step>
          <Step n={3} title="Select screenplay" icon={<Clapperboard />} done={Boolean(project.screenplay)}>
            {project.screenplay ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/screenplays/${project.screenplay.id}`} className="text-violet-300 hover:underline">{project.screenplay.title}</Link>
                <Badge variant="outline">{scenes.length} scenes · {project.screenplay.totalDuration}s</Badge>
                <Button size="sm" variant="secondary" onClick={() => setPreview(true)}><Play /> Preview storyboard</Button>
              </div>
            ) : project.script ? (
              <span>Open the script and click “Convert to screenplay”.</span>
            ) : <span>Needs a script first.</span>}
          </Step>
          <Step n={4} title="Generate voice audio" icon={<AudioLines />} done={scenes.length > 0 && withAudio === scenes.length} warn={!status?.active.tts}>
            <p>{withAudio}/{scenes.length} scenes have audio. Engine: {status?.active.tts ?? <span className="text-amber-300">none installed</span>}</p>
            <Button size="sm" variant="secondary" disabled={!project.screenplay} loading={genAudio.isPending || busy(jAudio)} onClick={() => genAudio.mutate(undefined)}><Mic2 /> Generate scene audio</Button>
            <JobProgress job={jAudio} />
          </Step>
          <Step n={5} title="Generate scene images" icon={<Images />} done={scenes.length > 0 && withImages === scenes.length} warn={status?.active.image === 'placeholder'}>
            <p>{withImages}/{scenes.length} scenes have images. Engine: {status?.active.image === 'placeholder' ? <span className="text-amber-300">placeholder art (no AI)</span> : status?.active.image}</p>
            <Button size="sm" variant="secondary" disabled={!project.screenplay} loading={genImages.isPending || busy(jImages)} onClick={() => genImages.mutate(undefined)}><Images /> Generate missing scene images</Button>
            <JobProgress job={jImages} />
          </Step>
          <Step n={6} title="Animate the influencer" icon={<Sparkles />} done={scenes.length > 0 && animated === scenes.length} warn={!animReady}>
            <p>{animated}/{scenes.length} scenes animated. {animReady ? `Engine: ${status?.active.animation}` : <span className="text-amber-300">No animation engine installed — scenes will use still images with camera motion.</span>}</p>
            <Button size="sm" variant="secondary" disabled={!withImages || !withAudio} loading={animate.isPending || busy(jAnim)} onClick={() => animate.mutate(undefined)}><Wand2 /> Animate scenes</Button>
            <JobProgress job={jAnim} />
          </Step>
          <Step n={7} title="Synchronize lips with audio" icon={<Mic2 />} done={scenes.length > 0 && animated === scenes.length} warn={!animReady}>
            <p>Lip sync is performed by the animation engine (MuseTalk / SadTalker / Wav2Lip) in step 6, driven by each scene’s audio.</p>
          </Step>
          <Step n={8} title="Combine scenes" icon={<Layers />} done={Boolean(final)}>
            <p>FFmpeg joins scene clips with transitions at {project.reelSettings.width}×{project.reelSettings.height}, {project.reelSettings.fps} fps.</p>
          </Step>
          <Step n={9} title="Add subtitles" icon={<Subtitles />} done={Boolean(final) && project.reelSettings.subtitles}>
            <p>{project.reelSettings.subtitles ? (project.reelSettings.burnSubtitles ? 'Burned-in captions' : 'Soft subtitle track') : 'Subtitles disabled'} · <Link to={`/projects/${project.id}?tab=settings`} className="text-violet-300 hover:underline">Reel settings</Link></p>
          </Step>
          <Step n={10} title="Export final video" icon={<Film />} done={Boolean(final)}>
            <Button size="sm" disabled={!scenes.length || ffmpeg?.state !== 'ready'} loading={render.isPending || busy(jRender)} onClick={() => render.mutate(undefined)}><Film /> Render MP4</Button>
            {!withAudio && scenes.length > 0 && <p className="text-xs text-amber-300">No voice audio yet — the render will be silent.</p>}
            <JobProgress job={jRender} />
          </Step>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Output</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {final?.url ? (
              <>
                <video key={final.url} src={final.url} controls className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-lg border bg-black" />
                {final.isDemo ? (
                  <Badge variant="warning">Storyboard animatic — no AI animation / lip sync</Badge>
                ) : (
                  <Badge variant="success">Animated video</Badge>
                )}
                <p className="text-xs text-muted-foreground">{final.notes}</p>
                <Button className="w-full" variant="secondary" onClick={() => downloadUrl(final.url!, `${project.name}.mp4`)}><Download /> Download MP4</Button>
              </>
            ) : (
              <EmptyState className="py-8" icon={<Film />} title="No video yet" description="Render the project to create a 9:16 MP4. You can always preview the storyboard and audio without rendering." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Animation engines</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {animProviders.map((p) => (
              <div key={p.id} className="space-y-1.5 rounded-md border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{p.name}</p>
                  <ProviderStateBadge state={p.state} />
                </div>
                <p className="text-xs text-muted-foreground">{String(p.details?.bestFor ?? '')}</p>
                {p.state !== 'ready' && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-violet-300">Setup</summary>
                    <SetupInstructions steps={p.setupInstructions} className="mt-2" />
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {project.screenplay && <StoryboardPlayer screenplay={project.screenplay} open={preview} onOpenChange={setPreview} />}
    </div>
  );
}

export default function VideoStudioPage() {
  const [params, setParams] = useSearchParams();
  const { data: projects, isLoading } = useProjects();
  const projectId = params.get('project') ?? projects?.[0]?.id ?? null;
  const { data: project, isLoading: loadingProject } = useProject(projectId);

  return (
    <div>
      <PageHeader
        icon={<Film className="h-5 w-5" />}
        title="Video Generation Studio"
        description="Voice → scene images → animation & lip sync → FFmpeg composition with subtitles → 9:16 MP4. Each engine is replaceable and shows its real status."
        actions={
          projects?.length ? (
            <NativeSelect
              className="w-72"
              value={projectId ?? ''}
              onChange={(e) => { params.set('project', e.target.value); setParams(params, { replace: true }); }}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          ) : null
        }
      />
      {isLoading || loadingProject ? (
        <LoadingBlock />
      ) : !projects?.length ? (
        <EmptyState icon={<Film />} title="No projects" description="Create a reel project to start generating video." action={<Button asChild><Link to="/projects?new=1">New project</Link></Button>} />
      ) : project ? (
        <ProjectPipeline project={project} />
      ) : null}
    </div>
  );
}
