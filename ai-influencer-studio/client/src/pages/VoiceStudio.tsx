import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { AudioLines, Download, Mic, Pencil, Play, Plus, RefreshCw, Trash2, Upload, UserCheck } from 'lucide-react';
import { LANGUAGES, VOICE_STYLES, type GeneratedAudio, type Job, type VoiceProfile } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useAudio, useInfluencers, useJob, useScreenplays, useScripts, useSystemStatus, useVoices } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, EmptyState, InfluencerAvatar, JobProgress, PageHeader, ProviderStateBadge, SetupInstructions, UnavailableNotice } from '@/components/common';
import { downloadUrl, timeAgo } from '@/lib/utils';

const voiceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  gender: z.enum(['female', 'male', 'non_binary', 'other']),
  language: z.enum(['hi', 'en', 'mr']),
  accent: z.string().max(100),
  pitch: z.number(),
  speed: z.number(),
  emotion: z.string().max(100),
  style: z.enum(['natural', 'energetic', 'professional', 'friendly', 'storytelling', 'cartoon_expressive']),
  provider: z.string(),
  providerVoiceId: z.string().max(200),
  referenceText: z.string().max(2000),
  description: z.string().max(1000),
});
type VoiceForm = z.infer<typeof voiceSchema>;
const EMPTY: VoiceForm = {
  name: '', gender: 'female', language: 'hi', accent: '', pitch: 0, speed: 1, emotion: 'Friendly', style: 'natural', provider: 'auto',
  providerVoiceId: '', referenceText: '', description: '',
};

function VoiceDialog({ voice, open, onOpenChange }: { voice: VoiceProfile | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: status } = useSystemStatus();
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<VoiceForm>({ resolver: zodResolver(voiceSchema) as never, defaultValues: EMPTY });
  useEffect(() => { if (open) reset(voice ? { ...voice } : EMPTY); }, [open, voice, reset]);
  const save = useApiMutation((v: VoiceForm) => (voice ? api.put(`/voices/${voice.id}`, v) : api.post('/voices', v)), {
    invalidate: [qk.voices], success: voice ? 'Voice updated' : 'Voice created', onSuccess: () => onOpenChange(false),
  });
  const ttsProviders = status?.providers.filter((p) => p.kind === 'tts') ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{voice ? 'Edit voice profile' : 'New voice profile'}</DialogTitle>
          <DialogDescription>Human influencers should use natural speech; cartoon influencers an expressive animated style (higher pitch, faster, bigger emotion).</DialogDescription>
        </DialogHeader>
        <form id="voice-form" onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Voice name" error={errors.name?.message} className="md:col-span-2"><Input {...register('name')} /></Field>
          <Field label="Gender">
            <NativeSelect {...register('gender')}><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="other">Other</option></NativeSelect>
          </Field>
          <Field label="Language"><NativeSelect {...register('language')}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</NativeSelect></Field>
          <Field label="Accent"><Input {...register('accent')} placeholder="Neutral Indian" /></Field>
          <Field label="Emotion"><Input {...register('emotion')} placeholder="Warm, upbeat…" /></Field>
          <Field label="Voice style"><NativeSelect {...register('style')}>{VOICE_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</NativeSelect></Field>
          <Field label="Pitch"><Slider value={watch('pitch')} min={-12} max={12} step={1} onChange={(v) => setValue('pitch', v)} format={(v) => `${v > 0 ? '+' : ''}${v} st`} /></Field>
          <Field label="Speed"><Slider value={watch('speed')} min={0.5} max={2} step={0.05} onChange={(v) => setValue('speed', v)} format={(v) => `${v.toFixed(2)}×`} /></Field>
          <Field label="TTS engine">
            <NativeSelect {...register('provider')}>
              <option value="auto">Auto (first installed)</option>
              {ttsProviders.map((p) => <option key={p.id} value={p.id}>{p.name} {p.state === 'ready' ? '' : `– ${p.state.replace('_', ' ')}`}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Engine voice / speaker id" hint="Optional, engine-specific"><Input {...register('providerVoiceId')} /></Field>
          <Field label="Reference transcript" hint="Exact words spoken in the reference clip (IndicF5)" className="md:col-span-2"><Input {...register('referenceText')} /></Field>
          <Field label="Description" className="md:col-span-3"><Textarea rows={2} {...register('description')} /></Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="voice-form" loading={save.isPending}>Save voice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AudioRow({ a, onDelete }: { a: GeneratedAudio; onDelete: () => void }) {
  const qc = useQueryClient();
  const retry = useApiMutation(() => api.post(`/jobs/${a.jobId}/retry`), {
    success: 'Regeneration queued', onSuccess: () => qc.invalidateQueries({ queryKey: ['audio'] }),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">{a.text}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={a.status === 'completed' ? 'success' : a.status === 'failed' ? 'danger' : 'info'}>{a.status}</Badge>
          {a.status === 'completed' && <Badge variant="outline">{a.provider}</Badge>}
          {a.durationSec && <span>{a.durationSec.toFixed(1)}s</span>}
          {a.sceneId && <span>· scene audio</span>}
          <span>· {timeAgo(a.createdAt)}</span>
        </div>
        {a.error && <p className="mt-1 text-xs text-red-300">{a.error}</p>}
      </div>
      {a.url && <audio controls src={a.url} className="h-9 w-full sm:w-64" />}
      <div className="flex gap-1">
        {a.url && <Button size="icon-sm" variant="ghost" onClick={() => downloadUrl(a.url!, `audio-${a.id.slice(0, 6)}.wav`)} aria-label="Download"><Download /></Button>}
        {a.jobId && a.status === 'failed' && <Button size="icon-sm" variant="ghost" onClick={() => retry.mutate(undefined)} loading={retry.isPending} aria-label="Regenerate"><RefreshCw /></Button>}
        <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete"><Trash2 /></Button>
      </div>
    </div>
  );
}

export default function VoiceStudioPage() {
  const [params] = useSearchParams();
  const { data: voices } = useVoices();
  const { data: influencers } = useInfluencers();
  const { data: scripts } = useScripts();
  const { data: screenplays } = useScreenplays();
  const { data: status } = useSystemStatus();
  const { data: audio } = useAudio({});
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<VoiceProfile | null>(null);
  const [previewJob, setPreviewJob] = useState<string | null>(null);
  const [speechJob, setSpeechJob] = useState<string | null>(null);
  const [influencerId, setInfluencerId] = useState(params.get('influencer') ?? '');
  const [mode, setMode] = useState<'scenes' | 'script'>('scenes');
  const [sourceId, setSourceId] = useState('');
  const [voiceOverride, setVoiceOverride] = useState('');
  const refUpload = useRef<HTMLInputElement>(null);
  const [refTarget, setRefTarget] = useState<VoiceProfile | null>(null);

  useEffect(() => { if (!influencerId && influencers?.[0]) setInfluencerId(influencers[0].id); }, [influencers, influencerId]);
  const inf = influencers?.find((i) => i.id === influencerId);
  const ttsStatuses = status?.providers.filter((p) => p.kind === 'tts') ?? [];
  const anyReady = ttsStatuses.some((p) => p.state === 'ready');

  const invalidateAudio = () => qc.invalidateQueries({ queryKey: ['audio'] });
  const preview = useJob(previewJob, { invalidate: [['audio']] });
  const speech = useJob(speechJob, { invalidate: [['audio'], ['screenplays']] });
  const previewAudio = audio?.find((a) => a.jobId === previewJob);

  const assign = useApiMutation((voiceProfileId: string | null) => api.post('/voices/assign', { influencerId, voiceProfileId }), {
    invalidate: [qk.influencers], success: 'Voice assigned',
  });
  const runPreview = useApiMutation((v: VoiceProfile) => api.post<{ job: Job }>(`/voices/${v.id}/preview`), {
    onSuccess: (r) => { setPreviewJob(r.job.id); invalidateAudio(); },
  });
  const remove = useApiMutation((id: string) => api.del(`/voices/${id}`), { invalidate: [qk.voices, qk.influencers], success: 'Voice deleted', onSuccess: () => setDeleting(null) });
  const removeAudio = useApiMutation((id: string) => api.del(`/voices/audio/${id}`), { success: 'Audio deleted', onSuccess: invalidateAudio });
  const uploadRef = useApiMutation((file: File) => api.upload(`/voices/${refTarget!.id}/reference`, file), { invalidate: [qk.voices], success: 'Reference clip uploaded' });
  const generate = useApiMutation(
    () => api.post<{ job: Job }>('/voices/speech', {
      influencerId, mode, voiceProfileId: voiceOverride || undefined,
      ...(mode === 'scenes' ? { screenplayId: sourceId } : { scriptId: sourceId }),
    }),
    { onSuccess: (r) => { setSpeechJob(r.job.id); invalidateAudio(); } },
  );

  const sources = mode === 'scenes'
    ? (screenplays ?? []).filter((s) => !influencerId || s.influencerId === influencerId)
    : (scripts ?? []).filter((s) => !influencerId || s.influencerId === influencerId);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Mic className="h-5 w-5" />}
        title="Voice Studio"
        description="Give every influencer a unique voice, preview it, and synthesize script or per-scene speech with free local TTS engines."
        actions={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus /> New voice</Button>}
      />

      {!anyReady && (
        <UnavailableNotice
          title="No text-to-speech engine is installed"
          message="Voice previews and speech generation will fail with setup instructions instead of producing fake audio. Install IndicF5 or MMS-TTS via the AI service (free, local) — or eSpeak NG for quick robotic tests."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>TTS engines</CardTitle>
          <CardDescription>Local, free engines. No paid API keys are needed.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {ttsStatuses.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{p.name}</p>
                <ProviderStateBadge state={p.state} />
              </div>
              <p className="text-xs text-muted-foreground">{p.message}</p>
              {p.setupInstructions.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-violet-300">Setup instructions</summary>
                  <SetupInstructions steps={p.setupInstructions} className="mt-2" />
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader><CardTitle>Voice profiles</CardTitle></CardHeader>
          <CardContent>
            <JobProgress job={preview} className="mb-3" />
            {previewAudio?.url && preview?.status === 'completed' && (
              <div className="mb-3 flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                <span className="text-xs text-emerald-300">Preview ready</span>
                <audio controls autoPlay src={previewAudio.url} className="h-8 flex-1" />
              </div>
            )}
            {!voices?.length ? (
              <EmptyState icon={<Mic />} title="No voice profiles" />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {voices.map((v) => {
                  const users = influencers?.filter((i) => i.voiceProfileId === v.id) ?? [];
                  return (
                    <div key={v.id} className="space-y-3 rounded-lg border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{v.name}</p>
                          <p className="text-xs text-muted-foreground">{v.description}</p>
                        </div>
                        <AudioLines className="h-5 w-5 shrink-0 text-violet-400" />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={v.style === 'cartoon_expressive' ? 'default' : 'info'}>{VOICE_STYLES.find((s) => s.value === v.style)?.label}</Badge>
                        <Badge variant="outline">{LANGUAGES.find((l) => l.code === v.language)?.label}</Badge>
                        <Badge variant="outline">{v.gender}</Badge>
                        <Badge variant="outline">{v.pitch > 0 ? '+' : ''}{v.pitch} st · {v.speed}×</Badge>
                        <Badge variant="outline">engine: {v.provider}</Badge>
                        {v.referenceAudioUrl && <Badge variant="success">reference clip</Badge>}
                      </div>
                      {users.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserCheck className="h-3.5 w-3.5" /> Used by {users.map((u) => u.name).join(', ')}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => runPreview.mutate(v)} loading={runPreview.isPending && runPreview.variables?.id === v.id}><Play /> Preview</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setEditing(v); setDialogOpen(true); }}><Pencil /> Edit</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setRefTarget(v); refUpload.current?.click(); }}><Upload /> Reference</Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(v)} aria-label="Delete"><Trash2 /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Assign voice</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <InfluencerAvatar influencer={inf} size={36} />
                <NativeSelect value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
                  {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.characterType})</option>)}
                </NativeSelect>
              </div>
              <NativeSelect value={inf?.voiceProfileId ?? ''} onChange={(e) => assign.mutate(e.target.value || null)}>
                <option value="">— no voice —</option>
                {voices?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
              {inf && (
                <p className="text-xs text-muted-foreground">
                  {inf.characterType === 'human' ? 'Human influencer → choose a natural voice style.' : 'Cartoon influencer → an expressive animated voice works best.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Generate speech</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={mode} onValueChange={(v) => { setMode(v as typeof mode); setSourceId(''); }}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="scenes">Per scene</TabsTrigger>
                  <TabsTrigger value="script">Whole script</TabsTrigger>
                </TabsList>
              </Tabs>
              <NativeSelect value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">{mode === 'scenes' ? 'Select a screenplay…' : 'Select a script…'}</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </NativeSelect>
              <NativeSelect value={voiceOverride} onChange={(e) => setVoiceOverride(e.target.value)}>
                <option value="">Use the influencer's assigned voice</option>
                {voices?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
              <Button className="w-full" disabled={!sourceId} loading={generate.isPending || speech?.status === 'running' || speech?.status === 'queued'} onClick={() => generate.mutate(undefined)}>
                <AudioLines /> Generate speech
              </Button>
              <JobProgress job={speech} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Generated audio</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!audio?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No audio generated yet.</p>
          ) : (
            audio.slice(0, 50).map((a) => <AudioRow key={a.id} a={a} onDelete={() => removeAudio.mutate(a.id)} />)
          )}
        </CardContent>
      </Card>

      <VoiceDialog voice={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name}?`} loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} />
      <input
        ref={refUpload}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && refTarget) uploadRef.mutate(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
