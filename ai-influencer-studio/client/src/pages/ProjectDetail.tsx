import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, AudioLines, Clapperboard, Copy, FileText, Film, FolderKanban, Hash, ImageIcon, Music, Sparkles, Upload, User, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectView, ReelSettings, SocialContent } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useInfluencers, useProject, useScreenplays, useScripts } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider, Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState, GenerationBadge, LoadingBlock } from '@/components/common';
import { ProjectPipeline } from '@/pages/VideoStudio';
import { STATUS_VARIANT } from '@/pages/Projects';

function TreeRow({ icon, label, value, to, done }: { icon: React.ReactNode; label: string; value: React.ReactNode; to?: string; done: boolean }) {
  const content = (
    <div className="flex items-center gap-3 py-2">
      <span className="text-muted-foreground">├──</span>
      <span className={`flex h-7 w-7 items-center justify-center rounded-md border [&_svg]:size-3.5 ${done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{icon}</span>
      <span className="w-32 text-sm font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{value}</span>
    </div>
  );
  return to ? <Link to={to} className="block rounded-md px-2 hover:bg-accent/40">{content}</Link> : <div className="px-2">{content}</div>;
}

function ReelSettingsForm({ project }: { project: ProjectView }) {
  const [s, setS] = useState<ReelSettings>(project.reelSettings);
  const music = useRef<HTMLInputElement>(null);
  useEffect(() => setS(project.reelSettings), [project.reelSettings]);
  const save = useApiMutation(() => api.put(`/projects/${project.id}`, { reelSettings: s }), { invalidate: [qk.project(project.id)], success: 'Reel settings saved' });
  const upload = useApiMutation((f: File) => api.upload(`/projects/${project.id}/music`, f), { invalidate: [qk.project(project.id)], success: 'Background music uploaded' });
  const set = <K extends keyof ReelSettings>(k: K, v: ReelSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram Reel settings</CardTitle>
        <CardDescription>9:16 · 1080 × 1920 · MP4 (H.264 + AAC)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Aspect ratio"><Input value="9:16" disabled /></Field>
          <Field label="Resolution"><Input value={`${s.width} × ${s.height}`} disabled /></Field>
          <Field label="FPS">
            <NativeSelect value={s.fps} onChange={(e) => set('fps', Number(e.target.value))}>{[24, 25, 30, 60].map((f) => <option key={f}>{f}</option>)}</NativeSelect>
          </Field>
          <Field label="Format"><Input value="MP4" disabled /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><p className="text-sm font-medium">Subtitles</p><p className="text-xs text-muted-foreground">Captions from each scene’s subtitle text</p></div>
            <Switch checked={s.subtitles} onCheckedChange={(v) => set('subtitles', v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><p className="text-sm font-medium">Burn into video</p><p className="text-xs text-muted-foreground">Off = soft subtitle track + .srt</p></div>
            <Switch checked={s.burnSubtitles} disabled={!s.subtitles} onCheckedChange={(v) => set('burnSubtitles', v)} />
          </div>
          <Field label="Watermark / logo text"><Input value={s.watermarkText} onChange={(e) => set('watermarkText', e.target.value)} placeholder="@yourhandle" /></Field>
          <Field label="Background music">
            <div className="flex items-center gap-2">
              {s.backgroundMusicUrl ? <audio controls src={s.backgroundMusicUrl} className="h-9 flex-1" /> : <span className="flex-1 text-xs text-muted-foreground">None</span>}
              <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => music.current?.click()}><Music /> Upload</Button>
              {s.backgroundMusicUrl && <Button size="sm" variant="ghost" onClick={() => set('backgroundMusicUrl', null)}>Remove</Button>}
            </div>
          </Field>
          <Field label="Music volume"><Slider value={s.musicVolume} min={0} max={1} step={0.05} onChange={(v) => set('musicVolume', v)} format={(v) => `${Math.round(v * 100)}%`} /></Field>
          <div />
          <Field label="Intro card text"><Input value={s.introText} onChange={(e) => set('introText', e.target.value)} placeholder="Optional 2.5 s title card" /></Field>
          <Field label="Outro card text"><Input value={s.outroText} onChange={(e) => set('outroText', e.target.value)} placeholder="Follow for more!" /></Field>
        </div>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save settings</Button>
        <input ref={music} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
      </CardContent>
    </Card>
  );
}

function SocialPanel({ project }: { project: ProjectView }) {
  const [s, setS] = useState<SocialContent | null>(project.social);
  useEffect(() => setS(project.social), [project.social]);
  const generate = useApiMutation(() => api.post<ProjectView>(`/projects/${project.id}/social`), {
    invalidate: [qk.project(project.id)], success: (p) => (p.social?.isDemo ? 'Created demo copy (template, no AI)' : 'Instagram copy generated'),
  });
  const save = useApiMutation(() => api.put(`/projects/${project.id}/social`, { ...s, hashtags: s!.hashtags }), { invalidate: [qk.project(project.id)], success: 'Saved' });
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copied'));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Instagram publishing copy</CardTitle>
          <CardDescription>Caption, hashtags, reel title, description and suggested posting time.</CardDescription>
        </div>
        <Button onClick={() => generate.mutate(undefined)} loading={generate.isPending} disabled={!project.scriptId}><Sparkles /> {s ? 'Regenerate' : 'Generate'}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!project.scriptId && <p className="text-sm text-muted-foreground">Attach a script to generate copy.</p>}
        {s && (
          <>
            <GenerationBadge provider={s.provider} isDemo={s.isDemo} />
            <Field label="Reel title"><Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
            <Field label="Caption">
              <div className="relative">
                <Textarea rows={5} value={s.caption} onChange={(e) => setS({ ...s, caption: e.target.value })} />
                <Button size="icon-sm" variant="ghost" className="absolute right-1 top-1" onClick={() => copy(s.caption)} aria-label="Copy caption"><Copy /></Button>
              </div>
            </Field>
            <Field label="Hashtags" hint="Space or comma separated">
              <div className="relative">
                <Textarea rows={2} value={s.hashtags.join(' ')} onChange={(e) => setS({ ...s, hashtags: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
                <Button size="icon-sm" variant="ghost" className="absolute right-1 top-1" onClick={() => copy(s.hashtags.join(' '))} aria-label="Copy hashtags"><Hash /></Button>
              </div>
            </Field>
            <Field label="Video description"><Textarea rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
            <Field label="Suggested posting time"><Input value={s.suggestedPostingTime} onChange={(e) => setS({ ...s, suggestedPostingTime: e.target.value })} /></Field>
            <Button variant="secondary" onClick={() => save.mutate(undefined)} loading={save.isPending}>Save copy</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const { data: p, isLoading, error, refetch } = useProject(id);
  const { data: influencers } = useInfluencers();
  const { data: scripts } = useScripts();
  const { data: screenplays } = useScreenplays();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => { if (p) { setName(p.name); setDescription(p.description); } }, [p]);
  const update = useApiMutation((body: Record<string, unknown>) => api.put(`/projects/${id}`, body), {
    invalidate: [qk.project(id ?? ''), qk.projects], success: 'Project saved',
  });

  if (isLoading) return <LoadingBlock />;
  if (error || !p) return <ErrorState error={error ?? new Error('Project not found')} onRetry={() => refetch()} />;
  const completedAudio = p.audio.filter((a) => a.status === 'completed').length;
  const sceneVideos = p.videos.filter((v) => v.kind === 'scene' && v.status === 'completed').length;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild><Link to="/projects"><ArrowLeft /> Projects</Link></Button>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white"><FolderKanban className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold">{p.name}</h1>
            <Badge variant={STATUS_VARIANT[p.status]}>{p.status.replace('_', ' ')}</Badge>
          </div>
        </div>
        <Button asChild><Link to={`/video-studio?project=${p.id}`}><Video /> Open in Video Studio</Link></Button>
      </div>

      <Tabs value={tab} onValueChange={(t) => { params.set('tab', t); setParams(params, { replace: true }); }}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="settings">Reel settings</TabsTrigger>
          <TabsTrigger value="publish">Publishing</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Project structure</CardTitle></CardHeader>
              <CardContent>
                <p className="px-2 pb-1 text-sm font-semibold">{p.name}</p>
                <TreeRow icon={<User />} label="Influencer" value={p.influencer?.name ?? '—'} to={p.influencer ? `/influencers/${p.influencer.id}` : undefined} done={Boolean(p.influencer)} />
                <TreeRow icon={<FileText />} label="Script" value={p.script?.title ?? '—'} to={p.script ? `/scripts/${p.script.id}` : undefined} done={Boolean(p.script)} />
                <TreeRow icon={<Clapperboard />} label="Screenplay" value={p.screenplay ? `${p.screenplay.title} (${p.screenplay.scenes.length} scenes)` : '—'} to={p.screenplay ? `/screenplays/${p.screenplay.id}` : undefined} done={Boolean(p.screenplay)} />
                <TreeRow icon={<ImageIcon />} label="Scene images" value={`${p.sceneImageCount} / ${p.screenplay?.scenes.length ?? 0}`} done={p.sceneImageCount > 0} />
                <TreeRow icon={<AudioLines />} label="Voice audio" value={`${completedAudio} clip(s)`} to="/voice-studio" done={completedAudio > 0} />
                <TreeRow icon={<Video />} label="Video scenes" value={`${sceneVideos} animated`} done={sceneVideos > 0} />
                <TreeRow icon={<Film />} label="Final video" value={p.finalVideo ? (p.finalVideo.isDemo ? 'Animatic (no lip sync)' : 'Rendered') : '—'} to={`/video-studio?project=${p.id}`} done={Boolean(p.finalVideo)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Details & links</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
                <Field label="Influencer">
                  <NativeSelect value={p.influencerId ?? ''} onChange={(e) => update.mutate({ influencerId: e.target.value || null })}>
                    <option value="">— none —</option>
                    {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.characterType})</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Script">
                  <NativeSelect value={p.scriptId ?? ''} onChange={(e) => update.mutate({ scriptId: e.target.value || null })}>
                    <option value="">— none —</option>
                    {scripts?.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Screenplay">
                  <NativeSelect value={p.screenplayId ?? ''} onChange={(e) => update.mutate({ screenplayId: e.target.value || null })}>
                    <option value="">— none —</option>
                    {screenplays?.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </NativeSelect>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => update.mutate({ name, description })} loading={update.isPending} disabled={!name.trim()}>Save</Button>
                  {!p.scriptId && (
                    <Button variant="secondary" asChild><Link to={`/scripts?new=1&influencer=${p.influencerId ?? ''}&project=${p.id}`}><Upload /> Write script for this project</Link></Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="pipeline"><ProjectPipeline project={p} /></TabsContent>
        <TabsContent value="settings"><ReelSettingsForm project={p} /></TabsContent>
        <TabsContent value="publish"><SocialPanel project={p} /></TabsContent>
      </Tabs>
    </div>
  );
}
