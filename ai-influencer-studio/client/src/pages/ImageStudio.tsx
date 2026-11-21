import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Crown, Eye, ImageIcon, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { EXPRESSION_PRESETS, OUTFIT_PRESETS, POSE_PRESETS, PROMPT_TEMPLATES } from '@shared/promptTemplates';
import { ASPECT_RATIOS, type AspectRatio, type ImageKind, type InfluencerImage, type Job } from '@shared/types';
import { api } from '@/lib/api';
import { qk, toastError, useApiMutation, useInfluencerImages, useInfluencers, useJob, useSystemStatus } from '@/lib/hooks';
import { useImageActions } from '@/lib/imageActions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { Slider, Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { EmptyState, InfluencerAvatar, JobProgress, PageHeader, UnavailableNotice } from '@/components/common';
import { ImageGrid } from '@/components/ImageGrid';
import { cn } from '@/lib/utils';

type Mode = 'prompt' | 'pose' | 'expression' | 'outfit';

const KINDS: { value: ImageKind; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'full_body', label: 'Full body' },
  { value: 'profile', label: 'Profile picture' },
  { value: 'pose', label: 'Pose' },
  { value: 'expression', label: 'Expression' },
  { value: 'outfit', label: 'Outfit' },
];

export default function ImageStudioPage() {
  const [params, setParams] = useSearchParams();
  const { data: influencers } = useInfluencers();
  const { data: status } = useSystemStatus();
  const influencerId = params.get('influencer') ?? influencers?.[0]?.id ?? null;
  const influencer = influencers?.find((i) => i.id === influencerId) ?? null;
  const { data: saved } = useInfluencerImages(influencerId, 'saved');
  const { data: previews } = useInfluencerImages(influencerId, 'preview');
  const actions = useImageActions(influencerId);

  const [mode, setMode] = useState<Mode>('prompt');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [pose, setPose] = useState('');
  const [expression, setExpression] = useState('');
  const [outfit, setOutfit] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [kind, setKind] = useState<ImageKind>('portrait');
  const [count, setCount] = useState(1);
  const [useMaster, setUseMaster] = useState(true);
  const [referenceImage, setReferenceImage] = useState<InfluencerImage | null>(null);
  const [strength, setStrength] = useState(0.6);
  const [composed, setComposed] = useState<{ prompt: string; negativePrompt: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showScenes, setShowScenes] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);

  const templates = useMemo(
    () => PROMPT_TEMPLATES.filter((t) => t.appliesTo === 'both' || t.appliesTo === influencer?.characterType),
    [influencer?.characterType],
  );
  const imageProvider = status?.providers.find((p) => p.id === status.active.image);

  useEffect(() => {
    setComposed(null);
  }, [influencerId, templateId, prompt, pose, expression, outfit, mode]);

  const body = () => ({
    influencerId,
    templateId: mode === 'prompt' ? templateId : null,
    prompt,
    pose: mode === 'pose' ? pose : undefined,
    expression: mode === 'expression' ? expression : undefined,
    outfit: mode === 'outfit' ? outfit : undefined,
    kind,
    aspectRatio: aspect,
    count,
    useMasterReference: useMaster,
    referenceImageId: referenceImage?.id ?? null,
    referenceStrength: strength,
  });

  const job = useJob(jobId, {
    invalidate: [['images'], qk.influencers],
    onDone: (j: Job) => {
      const r = j.result as { isDemo?: boolean; imageIds?: string[] } | null;
      if (r?.isDemo) toastDemo();
    },
  });

  const generate = useApiMutation(() => api.post<Job>('/images/generate', body()), { onSuccess: (j) => setJobId(j.id) });
  const preview = useApiMutation(() => api.post<{ prompt: string; negativePrompt: string }>('/images/compose', body()), {
    onSuccess: (r) => setComposed(r),
  });
  const uploadRef = useApiMutation((file: File) => api.upload<InfluencerImage>(`/influencers/${influencerId}/upload`, file, { role: 'gallery' }), {
    invalidate: [['images']],
    success: 'Reference uploaded (also added to the gallery)',
    onSuccess: (img) => setReferenceImage(img),
  });

  const selectTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(templateId === id ? null : id);
    setAspect(t.aspectRatio);
    setKind(t.kind);
  };

  const running = job && (job.status === 'queued' || job.status === 'running');
  const canGenerate =
    Boolean(influencerId) &&
    (mode === 'prompt' ? Boolean(prompt.trim() || templateId) : mode === 'pose' ? Boolean(pose) : mode === 'expression' ? Boolean(expression) : Boolean(outfit));

  return (
    <div>
      <PageHeader
        icon={<ImageIcon className="h-5 w-5" />}
        title="Influencer Image Studio"
        description="Generate consistent images of your influencer: every prompt starts from the saved appearance prompt and, when available, the master reference image."
      />

      {imageProvider?.isDemo && (
        <UnavailableNotice
          className="mb-6"
          title="No image model connected — the studio is in placeholder mode"
          message="Generations produce labelled placeholder art (not AI). Connect a local Stable Diffusion WebUI to generate real images."
          steps={status?.providers.find((p) => p.id === 'automatic1111')?.setupInstructions}
        />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_1fr]">
        <Card className="h-fit">
          <CardContent className="space-y-5 pt-5">
            <Field label="Influencer">
              <div className="flex items-center gap-2">
                <InfluencerAvatar influencer={influencer} size={36} />
                <NativeSelect
                  value={influencerId ?? ''}
                  onChange={(e) => {
                    params.set('influencer', e.target.value);
                    setParams(params, { replace: true });
                    setReferenceImage(null);
                  }}
                >
                  {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.characterType})</option>)}
                </NativeSelect>
              </div>
            </Field>

            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="prompt">Prompt</TabsTrigger>
                <TabsTrigger value="pose">Pose</TabsTrigger>
                <TabsTrigger value="expression">Expr.</TabsTrigger>
                <TabsTrigger value="outfit">Outfit</TabsTrigger>
              </TabsList>
              <TabsContent value="prompt" className="space-y-3">
                <Label>Templates</Label>
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => selectTemplate(t.id)}
                      title={t.description}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        templateId === t.id ? 'border-violet-500 bg-violet-500/15 text-violet-200' : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </TabsContent>
              {(['pose', 'expression', 'outfit'] as const).map((m) => {
                const presets = m === 'pose' ? POSE_PRESETS : m === 'expression' ? EXPRESSION_PRESETS : OUTFIT_PRESETS;
                const value = m === 'pose' ? pose : m === 'expression' ? expression : outfit;
                const set = m === 'pose' ? setPose : m === 'expression' ? setExpression : setOutfit;
                return (
                  <TabsContent key={m} value={m} className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((p) => (
                        <button
                          key={p}
                          onClick={() => { set(p); setKind(m); }}
                          className={cn('rounded-full border px-2.5 py-1 text-xs', value === p ? 'border-violet-500 bg-violet-500/15 text-violet-200' : 'text-muted-foreground hover:bg-accent')}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <Textarea rows={2} value={value} onChange={(e) => set(e.target.value)} placeholder={`Custom ${m}…`} />
                  </TabsContent>
                );
              })}
            </Tabs>

            <Field label={mode === 'prompt' ? 'Prompt' : 'Extra details (optional)'}>
              <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. holding a coffee cup in a sunny cafe" />
            </Field>

            <div>
              <Label>Aspect ratio</Label>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((a) => {
                  const r = ASPECT_RATIOS[a];
                  return (
                    <button
                      key={a}
                      onClick={() => setAspect(a)}
                      className={cn('flex flex-col items-center gap-1.5 rounded-md border p-2 text-xs', aspect === a ? 'border-violet-500 bg-violet-500/10' : 'hover:bg-accent')}
                    >
                      <span className="block border border-current opacity-70" style={{ width: (r.width / Math.max(r.width, r.height)) * 22, height: (r.height / Math.max(r.width, r.height)) * 22 }} />
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Image type">
                <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ImageKind)}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Variations">
                <NativeSelect value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </NativeSelect>
              </Field>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium"><Crown className="h-3.5 w-3.5 text-amber-400" /> Use master reference</p>
                  <p className="text-xs text-muted-foreground">Keeps the face/character consistent (img2img).</p>
                </div>
                <Switch checked={useMaster} onCheckedChange={setUseMaster} />
              </div>
              <div className="flex items-center gap-2">
                {referenceImage ? (
                  <div className="flex flex-1 items-center gap-2 rounded-md border p-1.5">
                    <img src={referenceImage.url} alt="" className="h-10 w-10 rounded object-cover" />
                    <span className="flex-1 text-xs">Custom reference image</span>
                    <Button size="icon-sm" variant="ghost" onClick={() => setReferenceImage(null)} aria-label="Remove reference"><X /></Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" className="flex-1" loading={uploadRef.isPending} onClick={() => refInput.current?.click()}>
                    <Upload /> Upload reference image
                  </Button>
                )}
              </div>
              <Field label="Reference strength" hint="Lower = closer to the reference">
                <Slider value={strength} min={0.2} max={0.9} step={0.05} onChange={setStrength} format={(v) => v.toFixed(2)} />
              </Field>
            </div>

            {composed && (
              <div className="space-y-1 rounded-md border bg-black/30 p-3 text-xs">
                <p className="text-muted-foreground">Final prompt sent to the model:</p>
                <p className="font-mono text-slate-300">{composed.prompt}</p>
                <p className="pt-1 text-muted-foreground">Negative: <span className="font-mono text-slate-400">{composed.negativePrompt}</span></p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => preview.mutate(undefined)} disabled={!canGenerate} loading={preview.isPending}>
                <Eye /> Preview prompt
              </Button>
              <Button className="flex-1" onClick={() => generate.mutate(undefined)} disabled={!canGenerate || Boolean(running)} loading={generate.isPending || Boolean(running)}>
                <Wand2 /> Generate
              </Button>
            </div>
            {imageProvider && (
              <p className="text-center text-xs text-muted-foreground">
                Engine: <span className={imageProvider.isDemo ? 'text-amber-300' : 'text-emerald-300'}>{imageProvider.name}</span> ·{' '}
                <Link to="/settings" className="underline-offset-2 hover:underline">change</Link>
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <JobProgress job={job} />
          {previews && previews.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-400" /> New generations — review before saving</CardTitle>
                <Badge variant="default">{previews.length} preview{previews.length > 1 ? 's' : ''}</Badge>
              </CardHeader>
              <CardContent><ImageGrid images={previews} influencer={influencer} actions={actions} /></CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{influencer?.name ?? 'Influencer'}'s gallery</CardTitle>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showScenes} onCheckedChange={setShowScenes} /> Show storyboard scene frames
              </label>
            </CardHeader>
            <CardContent>
              {saved && saved.filter((i) => showScenes || i.kind !== 'scene').length ? (
                <ImageGrid images={saved.filter((i) => showScenes || i.kind !== 'scene')} influencer={influencer} actions={actions} />
              ) : (
                <EmptyState icon={<ImageIcon />} title="No saved images" description="Generate images on the left, then save the ones you like." />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <input
        ref={refInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadRef.mutate(f);
          else toastError(new Error('No file selected'));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function toastDemo() {
  toast.warning('Placeholder images created', { description: 'No image model is connected, so these are labelled placeholders — not AI generations.' });
}
