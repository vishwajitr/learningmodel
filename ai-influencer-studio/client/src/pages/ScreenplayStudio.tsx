import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, Camera, Clapperboard, Clock, Copy, GripVertical, ImageIcon, Images, Pause, Pencil, Play, Plus, RefreshCw,
  SkipBack, SkipForward, Smile, Trash2, Volume2,
} from 'lucide-react';
import {
  BACKGROUNDS, CAMERA_ANGLES, CAMERA_MOVEMENTS, EXPRESSIONS, TRANSITIONS, type Job, type Scene, type ScreenplayView,
} from '@shared/types';
import { api } from '@/lib/api';
import { qk, toastError, useApiMutation, useInfluencers, useJob, useScreenplay, useScreenplays, useScripts } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress, Slider } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ConfirmDialog, EmptyState, ErrorState, GenerationBadge, InfluencerAvatar, JobProgress, LoadingBlock, PageHeader,
} from '@/components/common';
import { cn, formatSeconds, timeAgo } from '@/lib/utils';

type SceneFields = Omit<Scene, 'id' | 'screenplayId' | 'orderIndex' | 'thumbnailImageId' | 'thumbnailUrl' | 'audioId' | 'audioUrl' | 'createdAt' | 'updatedAt'>;

function ComboInput({ value, onChange, options, id }: { value: string; onChange: (v: string) => void; options: string[]; id: string }) {
  return (
    <>
      <Input list={id} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}

function SceneEditDialog({ scene, open, onOpenChange, onSaved }: { scene: Scene | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [f, setF] = useState<SceneFields | null>(null);
  useEffect(() => {
    if (scene && open) {
      const { id: _i, screenplayId: _s, orderIndex: _o, thumbnailImageId: _t, thumbnailUrl: _tu, audioId: _a, audioUrl: _au, createdAt: _c, updatedAt: _u, ...rest } = scene;
      setF(rest);
    }
  }, [scene, open]);
  const save = useApiMutation(
    (refresh: boolean) => api.put<Scene>(`/screenplays/scenes/${scene!.id}`, { ...f, refreshVisualPrompt: refresh }),
    { success: 'Scene updated', onSuccess: () => { onSaved(); onOpenChange(false); } },
  );
  if (!f || !scene) return null;
  const set = <K extends keyof SceneFields>(k: K, v: SceneFields[K]) => setF((p) => (p ? { ...p, [k]: v } : p));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Edit scene {scene.orderIndex + 1}</DialogTitle>
          <DialogDescription>Changing the dialogue clears this scene’s generated audio so it can be re-synthesized.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Spoken dialogue" className="md:col-span-2"><Textarea rows={3} value={f.dialogue} onChange={(e) => set('dialogue', e.target.value)} /></Field>
          <Field label="Subtitle text" className="md:col-span-2"><Input value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>
          <Field label="Scene description"><Input value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label={`Duration – ${f.duration}s`}><Slider value={f.duration} min={1} max={30} step={0.5} onChange={(v) => set('duration', v)} format={(v) => `${v}s`} /></Field>
          <Field label="Influencer action"><Input value={f.action} onChange={(e) => set('action', e.target.value)} /></Field>
          <Field label="Body language"><Input value={f.bodyLanguage} onChange={(e) => set('bodyLanguage', e.target.value)} /></Field>
          <Field label="Facial expression"><ComboInput id="expr" value={f.expression} onChange={(v) => set('expression', v)} options={EXPRESSIONS} /></Field>
          <Field label="Voice emotion"><Input value={f.voiceEmotion} onChange={(e) => set('voiceEmotion', e.target.value)} /></Field>
          <Field label="Camera angle"><ComboInput id="cam" value={f.cameraAngle} onChange={(v) => set('cameraAngle', v)} options={CAMERA_ANGLES} /></Field>
          <Field label="Camera movement"><ComboInput id="move" value={f.cameraMovement} onChange={(v) => set('cameraMovement', v)} options={CAMERA_MOVEMENTS} /></Field>
          <Field label="Background"><ComboInput id="bg" value={f.background} onChange={(v) => set('background', v)} options={BACKGROUNDS} /></Field>
          <Field label="Transition"><ComboInput id="tr" value={f.transition} onChange={(v) => set('transition', v)} options={TRANSITIONS} /></Field>
          <Field label="Visual generation prompt" className="md:col-span-2" hint="Used for the scene image. Includes the influencer's fixed appearance for consistency.">
            <Textarea rows={4} value={f.visualPrompt} onChange={(e) => set('visualPrompt', e.target.value)} className="font-mono text-xs" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate(true)} title="Rebuild the visual prompt from action, expression, camera and background">
            <RefreshCw /> Save & rebuild prompt
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(false)}>Save scene</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SceneCard({
  scene, onEdit, onRegenerate, onDelete, regenerating,
}: { scene: Scene; onEdit: () => void; onRegenerate: () => void; onDelete: () => void; regenerating: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex flex-col overflow-hidden rounded-lg border bg-card', isDragging && 'z-10 opacity-80 shadow-2xl ring-2 ring-violet-500')}
    >
      <div className="relative aspect-[4/5] bg-muted">
        {scene.thumbnailUrl ? (
          <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-violet-900/30 to-blue-900/20 p-4 text-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
            <p className="text-xs">{scene.cameraAngle}</p>
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <Badge className="bg-black/70 text-white">Scene {scene.orderIndex + 1}</Badge>
          <Badge className="bg-black/70 text-white"><Clock /> {scene.duration}s</Badge>
        </div>
        {scene.audioUrl && <Badge className="absolute bottom-2 left-2 bg-emerald-600/80 text-white"><Volume2 /> audio</Badge>}
        <button
          {...attributes}
          {...listeners}
          className="absolute right-2 top-2 cursor-grab rounded-md bg-black/60 p-1 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-3 text-sm leading-snug">“{scene.dialogue || '—'}”</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{scene.action}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline"><Smile /> {scene.expression}</Badge>
          <Badge variant="outline"><Camera /> {scene.cameraAngle}</Badge>
        </div>
        <div className="mt-auto flex gap-1 pt-1">
          <Button size="sm" variant="secondary" className="flex-1" onClick={onEdit}><Pencil /> Edit</Button>
          <Button size="icon-sm" variant="ghost" onClick={onRegenerate} loading={regenerating} aria-label="Regenerate direction" title="Regenerate camera / acting direction"><RefreshCw /></Button>
          <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete scene"><Trash2 /></Button>
        </div>
      </div>
    </div>
  );
}

/** Plays the storyboard scene by scene: image + subtitle + scene audio (when generated). */
export function StoryboardPlayer({ screenplay, open, onOpenChange }: { screenplay: ScreenplayView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const scenes = screenplay.scenes;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scene = scenes[index];

  useEffect(() => {
    if (!open) { setPlaying(false); setIndex(0); setElapsed(0); }
  }, [open]);

  useEffect(() => {
    if (!playing || !scene) return;
    const started = Date.now() - elapsed * 1000;
    const t = setInterval(() => {
      const e = (Date.now() - started) / 1000;
      const audio = audioRef.current;
      const sceneLen = Math.max(scene.duration, audio && !Number.isNaN(audio.duration) && scene.audioUrl ? audio.duration : 0);
      if (e >= sceneLen) {
        if (index < scenes.length - 1) { setIndex((i) => i + 1); setElapsed(0); }
        else { setPlaying(false); setElapsed(sceneLen); }
      } else setElapsed(e);
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, scene]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && scene?.audioUrl) { a.currentTime = elapsed; a.play().catch(() => undefined); } else a.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index]);

  if (!scene) return null;
  const before = scenes.slice(0, index).reduce((a, s) => a + s.duration, 0);
  const total = screenplay.totalDuration || 1;
  const go = (i: number) => { setIndex(Math.max(0, Math.min(scenes.length - 1, i))); setElapsed(0); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Storyboard preview</DialogTitle>
          <DialogDescription>Scene {index + 1} of {scenes.length} · {scene.cameraAngle} · {scene.cameraMovement}</DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-lg border bg-black">
          {scene.thumbnailUrl ? (
            <img
              key={scene.id}
              src={scene.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover transition-transform ease-linear"
              style={{
                transform: /push|in/i.test(scene.cameraMovement) ? `scale(${1 + Math.min(elapsed / scene.duration, 1) * 0.12})` : /pull|out/i.test(scene.cameraMovement) ? `scale(${1.12 - Math.min(elapsed / scene.duration, 1) * 0.12})` : undefined,
                transitionDuration: '100ms',
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Clapperboard className="h-8 w-8" />
              <p>{scene.action}</p>
              <p className="text-xs">({scene.expression} · {scene.background})</p>
            </div>
          )}
          <div className="absolute inset-x-3 bottom-8 rounded-md bg-black/60 px-2 py-1.5 text-center text-sm font-semibold leading-snug text-white">
            {scene.subtitle || scene.dialogue}
          </div>
          <Badge className="absolute left-2 top-2 bg-black/70 text-white">{scene.transition}</Badge>
          {!scene.audioUrl && <Badge className="absolute right-2 top-2 bg-black/70 text-white">no audio</Badge>}
        </div>
        {scene.audioUrl && <audio ref={audioRef} src={scene.audioUrl} preload="auto" />}
        <Progress value={((before + elapsed) / total) * 100} />
        <div className="flex items-center justify-center gap-2">
          <Button size="icon" variant="secondary" onClick={() => go(index - 1)} aria-label="Previous"><SkipBack /></Button>
          <Button size="icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</Button>
          <Button size="icon" variant="secondary" onClick={() => go(index + 1)} aria-label="Next"><SkipForward /></Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {formatSeconds(before + elapsed)} / {formatSeconds(total)} · This is an interactive preview, not a rendered video.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ScreenplayEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: sp, isLoading, error, refetch } = useScreenplay(id);
  const { data: influencers } = useInfluencers();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [editing, setEditing] = useState<Scene | null>(null);
  const [deleting, setDeleting] = useState<Scene | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => { if (sp) { setScenes(sp.scenes); setTitle(sp.title); } }, [sp]);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.screenplay(id) });
  const job = useJob(jobId, { invalidate: [qk.screenplay(id), ['images']] });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    const next = arrayMove(scenes, oldIndex, newIndex).map((s, i) => ({ ...s, orderIndex: i }));
    setScenes(next);
    try {
      await api.post(`/screenplays/${id}/reorder`, { sceneIds: next.map((s) => s.id) });
      refresh();
    } catch (err) {
      toastError(err);
      refetch();
    }
  };

  const addScene = useApiMutation(() => api.post<Scene>(`/screenplays/${id}/scenes`, {}), {
    success: 'Scene added',
    onSuccess: (s) => { refresh(); setEditing(s); },
  });
  const removeScene = useApiMutation((sceneId: string) => api.del(`/screenplays/scenes/${sceneId}`), {
    success: 'Scene deleted',
    onSuccess: () => { setDeleting(null); refresh(); },
  });
  const regenScene = useApiMutation(
    (sceneId: string) => { setRegenId(sceneId); return api.post<{ scene: Scene; isDemo: boolean; provider: string }>(`/screenplays/scenes/${sceneId}/regenerate`, {}); },
    {
      success: (r) => (r.isDemo ? 'Camera angle rotated (rule-based, no AI)' : `Scene re-directed by ${r.provider}`),
      onSuccess: () => { setRegenId(null); refresh(); },
    },
  );
  useEffect(() => { if (!regenScene.isPending) setRegenId(null); }, [regenScene.isPending]);
  const update = useApiMutation((body: Record<string, unknown>) => api.put<ScreenplayView>(`/screenplays/${id}`, body), {
    invalidate: [qk.screenplays, qk.screenplay(id)],
    success: 'Screenplay updated',
  });
  const images = useApiMutation((overwrite: boolean) => api.post<Job>(`/screenplays/${id}/images`, { overwrite }), {
    onSuccess: (j) => setJobId(j.id),
  });
  const duplicate = useApiMutation(() => api.post<ScreenplayView>(`/screenplays/${id}/duplicate`), {
    invalidate: [qk.screenplays], success: 'Screenplay duplicated', onSuccess: (s) => navigate(`/screenplays/${s.id}`),
  });
  const remove = useApiMutation(() => api.del(`/screenplays/${id}`), {
    invalidate: [qk.screenplays], success: 'Screenplay deleted', onSuccess: () => navigate('/screenplays'),
  });

  const total = useMemo(() => scenes.reduce((a, s) => a + s.duration, 0), [scenes]);
  if (isLoading) return <LoadingBlock />;
  if (error || !sp) return <ErrorState error={error ?? new Error('Screenplay not found')} onRetry={() => refetch()} />;
  const inf = influencers?.find((i) => i.id === sp.influencerId);
  const running = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild><Link to="/screenplays"><ArrowLeft /> All screenplays</Link></Button>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== sp.title && title.trim() && update.mutate({ title })} className="h-10 text-lg font-semibold" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <GenerationBadge provider={sp.provider} isDemo={sp.isDemo} />
              <Badge variant="outline"><Clock /> {formatSeconds(total)} · {scenes.length} scenes</Badge>
              {sp.scriptId && <Link to={`/scripts/${sp.scriptId}`} className="text-xs text-violet-300 hover:underline">Source script</Link>}
              <div className="flex items-center gap-2">
                <InfluencerAvatar influencer={inf} size={22} />
                <NativeSelect className="h-7 w-44 text-xs" value={sp.influencerId ?? ''} onChange={(e) => update.mutate({ influencerId: e.target.value || null })}>
                  <option value="">No influencer</option>
                  {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </NativeSelect>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPreview(true)} disabled={!scenes.length}><Play /> Preview</Button>
            <Button variant="secondary" onClick={() => images.mutate(false)} loading={images.isPending || Boolean(running)} disabled={!sp.influencerId}>
              <Images /> Generate scene images
            </Button>
            <Button onClick={() => addScene.mutate(undefined)} loading={addScene.isPending}><Plus /> Add scene</Button>
            <Button variant="ghost" size="icon" onClick={() => duplicate.mutate(undefined)} title="Duplicate" aria-label="Duplicate"><Copy /></Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} title="Delete" aria-label="Delete"><Trash2 /></Button>
          </div>
        </CardContent>
      </Card>

      <JobProgress job={job} onRetry={() => qc.invalidateQueries({ queryKey: ['job', jobId] })} />

      {scenes.length === 0 ? (
        <EmptyState icon={<Clapperboard />} title="No scenes" description="Add scenes manually or convert a script into a screenplay." action={<Button onClick={() => addScene.mutate(undefined)}><Plus /> Add scene</Button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={scenes.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {scenes.map((s) => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  onEdit={() => setEditing(s)}
                  onDelete={() => setDeleting(s)}
                  onRegenerate={() => regenScene.mutate(s.id)}
                  regenerating={regenId === s.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Card>
        <CardHeader><CardTitle>Screenplay (text view)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {scenes.map((s) => (
            <div key={s.id} className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-semibold">Scene {s.orderIndex + 1} <span className="font-normal text-muted-foreground">· {s.duration}s · {s.description}</span></p>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">Action: </dt><dd className="inline">{s.action}</dd></div>
                <div><dt className="inline text-muted-foreground">Expression: </dt><dd className="inline">{s.expression}</dd></div>
                <div><dt className="inline text-muted-foreground">Body language: </dt><dd className="inline">{s.bodyLanguage}</dd></div>
                <div><dt className="inline text-muted-foreground">Camera: </dt><dd className="inline">{s.cameraAngle}, {s.cameraMovement}</dd></div>
                <div><dt className="inline text-muted-foreground">Background: </dt><dd className="inline">{s.background}</dd></div>
                <div><dt className="inline text-muted-foreground">Voice emotion: </dt><dd className="inline">{s.voiceEmotion}</dd></div>
                <div><dt className="inline text-muted-foreground">Transition: </dt><dd className="inline">{s.transition}</dd></div>
                <div><dt className="inline text-muted-foreground">Subtitle: </dt><dd className="inline">{s.subtitle}</dd></div>
              </dl>
              <p className="mt-2">Dialogue: “{s.dialogue}”</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <SceneEditDialog scene={editing} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} onSaved={refresh} />
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete scene ${(deleting?.orderIndex ?? 0) + 1}?`} loading={removeScene.isPending} onConfirm={() => deleting && removeScene.mutate(deleting.id)} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this screenplay?" description="All its scenes will be deleted." loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
      {sp && <StoryboardPlayer screenplay={{ ...sp, scenes, totalDuration: total }} open={preview} onOpenChange={setPreview} />}
    </div>
  );
}

function NewScreenplayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { data: scripts } = useScripts();
  const { data: influencers } = useInfluencers();
  const [scriptId, setScriptId] = useState('');
  const [title, setTitle] = useState('');
  const [influencerId, setInfluencerId] = useState('');
  const fromScript = useApiMutation(() => api.post<ScreenplayView>(`/scripts/${scriptId}/screenplay`), {
    invalidate: [qk.screenplays], success: (s) => `Created ${s.scenes.length} scenes`, onSuccess: (s) => navigate(`/screenplays/${s.id}`),
  });
  const blank = useApiMutation(() => api.post<ScreenplayView>('/screenplays', { title, influencerId: influencerId || null }), {
    invalidate: [qk.screenplays], success: 'Screenplay created', onSuccess: (s) => navigate(`/screenplays/${s.id}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create screenplay</DialogTitle>
          <DialogDescription>Convert an existing script into scenes, or start a blank storyboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">From a script</p>
          <NativeSelect value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
            <option value="">Select a script…</option>
            {scripts?.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </NativeSelect>
          <Button className="w-full" disabled={!scriptId} loading={fromScript.isPending} onClick={() => fromScript.mutate(undefined)}>Convert script to scenes</Button>
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Blank storyboard</p>
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <NativeSelect value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
            <option value="">No influencer</option>
            {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </NativeSelect>
          <Button variant="secondary" className="w-full" disabled={!title.trim()} loading={blank.isPending} onClick={() => blank.mutate(undefined)}>Create blank</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ScreenplayStudioPage() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useScreenplays();
  const { data: influencers } = useInfluencers();
  const [newOpen, setNewOpen] = useState(false);

  if (id) return <ScreenplayEditor key={id} id={id} />;

  return (
    <div>
      <PageHeader
        icon={<Clapperboard className="h-5 w-5" />}
        title="Screenplay Studio"
        description="Turn scripts into scene-by-scene storyboards with camera direction, expressions, dialogue, subtitles and per-scene image prompts."
        actions={<Button onClick={() => setNewOpen(true)}><Plus /> New screenplay</Button>}
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState icon={<Clapperboard />} title="No screenplays yet" description="Write a script first, then convert it into a storyboard." action={<Button onClick={() => setNewOpen(true)}><Plus /> New screenplay</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((sp) => {
            const inf = influencers?.find((i) => i.id === sp.influencerId);
            return (
              <Link key={sp.id} to={`/screenplays/${sp.id}`} className="group overflow-hidden rounded-lg border bg-card/80 transition-colors hover:border-violet-500/40">
                <div className="flex h-28 gap-1 overflow-hidden bg-muted/40 p-1">
                  {sp.scenes.slice(0, 6).map((s) => (
                    <div key={s.id} className="h-full flex-1 overflow-hidden rounded bg-muted">
                      {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{s.orderIndex + 1}</div>}
                    </div>
                  ))}
                </div>
                <div className="space-y-2 p-4">
                  <p className="truncate font-medium group-hover:text-violet-300">{sp.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <GenerationBadge provider={sp.provider} isDemo={sp.isDemo} />
                    <Badge variant="outline">{sp.scenes.length} scenes · {formatSeconds(sp.totalDuration)}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><InfluencerAvatar influencer={inf} size={18} /> {inf?.name ?? 'No influencer'}</span>
                    <span>{timeAgo(sp.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <NewScreenplayDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
