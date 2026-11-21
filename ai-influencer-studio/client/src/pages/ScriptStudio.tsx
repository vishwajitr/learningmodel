import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Clapperboard, Copy, Download, FileText, MoreVertical, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Wand2,
} from 'lucide-react';
import {
  CONTENT_CATEGORIES, LANGUAGES, PLATFORMS, SCRIPT_SECTIONS, TONES, VIDEO_DURATIONS,
  type Language, type ScreenplayView, type Script, type ScriptSectionKey, type ScriptSections,
} from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useInfluencers, useScript, useScripts, useSystemStatus } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, EmptyState, ErrorState, GenerationBadge, InfluencerAvatar, LoadingBlock, PageHeader, UnavailableNotice } from '@/components/common';
import { cn, downloadUrl, timeAgo } from '@/lib/utils';

const WPS: Record<Language, number> = { en: 2.5, hi: 2.3, mr: 2.2 };

const briefSchema = z.object({
  influencerId: z.string().min(1, 'Select an influencer'),
  topic: z.string().trim().min(3, 'Topic must be at least 3 characters').max(300),
  category: z.enum(CONTENT_CATEGORIES),
  language: z.enum(['hi', 'en', 'mr']),
  duration: z.coerce.number(),
  tone: z.enum(TONES),
  targetAudience: z.string().max(300),
  platform: z.enum(PLATFORMS),
  callToAction: z.string().max(300),
});
type Brief = z.infer<typeof briefSchema>;

function NewScriptForm({ onCreated }: { onCreated: (s: Script) => void }) {
  const [params] = useSearchParams();
  const { data: influencers } = useInfluencers();
  const { data: status } = useSystemStatus();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<Brief>({
    resolver: zodResolver(briefSchema) as never,
    defaultValues: {
      influencerId: params.get('influencer') ?? '', topic: '', category: 'Technology', language: 'hi', duration: 30, tone: 'Friendly',
      targetAudience: '', platform: 'Instagram Reels', callToAction: '',
    },
  });
  const influencerId = watch('influencerId');
  const inf = influencers?.find((i) => i.id === influencerId);
  useEffect(() => {
    if (!influencerId && influencers?.[0]) setValue('influencerId', influencers[0].id);
  }, [influencers, influencerId, setValue]);
  useEffect(() => {
    if (inf) setValue('language', inf.primaryLanguage);
  }, [inf, setValue]);

  const generate = useApiMutation(
    (b: Brief) => api.post<Script>('/scripts/generate', { ...b, projectId: params.get('project') }),
    {
      invalidate: [qk.scripts, qk.influencers],
      success: (s) => (s.isDemo ? null : 'Script generated'),
      onSuccess: (s) => onCreated(s),
    },
  );
  const llmDemo = status?.active.llm === 'template-demo';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-400" /> New script</CardTitle>
        <CardDescription>Generates Hook → Introduction → Main content → Engagement → CTA, written to sound like your influencer speaking naturally.</CardDescription>
      </CardHeader>
      <CardContent>
        {llmDemo && (
          <UnavailableNotice
            className="mb-5"
            title="No language model connected — demo template writer is active"
            message="Scripts will be filled from fixed Hindi / English / Marathi templates and labelled as demo. Add an Anthropic API key or run Ollama locally for real AI writing."
            steps={[
              ...(status?.providers.find((p) => p.id === 'ollama')?.setupInstructions ?? []),
              ...(status?.providers.find((p) => p.id === 'anthropic')?.setupInstructions ?? []),
            ]}
          />
        )}
        <form onSubmit={handleSubmit((b) => generate.mutate(b))} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Influencer" error={errors.influencerId?.message}>
            <div className="flex items-center gap-2">
              <InfluencerAvatar influencer={inf} size={36} />
              <NativeSelect {...register('influencerId')}>
                {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.characterType})</option>)}
              </NativeSelect>
            </div>
          </Field>
          <Field label="Language">
            <NativeSelect {...register('language')}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label} – {l.native}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Topic" error={errors.topic?.message} className="md:col-span-2">
            <Input {...register('topic')} placeholder="e.g. 5 budget-friendly street foods in Pune" />
          </Field>
          <Field label="Content category">
            <NativeSelect {...register('category')}>{CONTENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
          </Field>
          <Field label="Tone">
            <NativeSelect {...register('tone')}>{TONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect>
          </Field>
          <Field label="Video duration">
            <NativeSelect {...register('duration')}>{VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d} seconds</option>)}</NativeSelect>
          </Field>
          <Field label="Platform">
            <NativeSelect {...register('platform')}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</NativeSelect>
          </Field>
          <Field label="Target audience"><Input {...register('targetAudience')} placeholder="College students in Maharashtra" /></Field>
          <Field label="Call to action"><Input {...register('callToAction')} placeholder="Follow for daily tech tips" /></Field>
          <div className="md:col-span-2">
            <Button type="submit" size="lg" className="w-full" loading={generate.isPending}>
              <Wand2 /> {generate.isPending ? 'Writing script…' : llmDemo ? 'Create demo script (template)' : 'Generate script'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ScriptEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: script, isLoading, error, refetch } = useScript(id);
  const { data: influencers } = useInfluencers();
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<ScriptSections | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [regenerating, setRegenerating] = useState<ScriptSectionKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (script) {
      setTitle(script.title);
      setSections(script.sections);
    }
  }, [script]);

  const dirty = Boolean(script && sections && (title !== script.title || JSON.stringify(sections) !== JSON.stringify(script.sections)));

  const save = useApiMutation(
    (extra: Partial<Script> = {}) => api.put<Script>(`/scripts/${id}`, { title, sections, ...extra }),
    { invalidate: [qk.scripts, qk.script(id)], success: 'Script saved' },
  );
  const duplicate = useApiMutation(() => api.post<Script>(`/scripts/${id}/duplicate`), {
    invalidate: [qk.scripts],
    success: 'Script duplicated',
    onSuccess: (s) => navigate(`/scripts/${s.id}`),
  });
  const remove = useApiMutation(() => api.del(`/scripts/${id}`), {
    invalidate: [qk.scripts],
    success: 'Script deleted',
    onSuccess: () => navigate('/scripts'),
  });
  const toScreenplay = useApiMutation(
    async () => {
      if (dirty) await api.put(`/scripts/${id}`, { title, sections });
      return api.post<ScreenplayView>(`/scripts/${id}/screenplay`);
    },
    {
      invalidate: [qk.screenplays, qk.projects],
      success: (sp) => `Created ${sp.scenes.length} scenes`,
      onSuccess: (sp) => navigate(`/screenplays/${sp.id}`),
    },
  );
  const regen = useApiMutation(
    async (key: ScriptSectionKey) => {
      setRegenerating(key);
      if (dirty) await api.put(`/scripts/${id}`, { title, sections });
      return api.post<{ script: Script; isDemo: boolean; provider: string }>(`/scripts/${id}/sections/${key}/regenerate`, { instructions: instructions[key] ?? '' });
    },
    {
      invalidate: [qk.script(id), qk.scripts],
      success: (r) => (r.isDemo ? 'Section replaced with another demo template line (no AI)' : `Section rewritten by ${r.provider}`),
      onSuccess: (r) => {
        setSections(r.script.sections);
        setRegenerating(null);
      },
    },
  );
  useEffect(() => {
    if (!regen.isPending) setRegenerating(null);
  }, [regen.isPending]);

  const stats = useMemo(() => {
    if (!sections || !script) return null;
    const words = Object.values(sections).join(' ').split(/\s+/).filter(Boolean).length;
    return { words, seconds: Math.round(words / WPS[script.language]) };
  }, [sections, script]);

  if (isLoading) return <LoadingBlock />;
  if (error || !script || !sections) return <ErrorState error={error ?? new Error('Script not found')} onRetry={() => refetch()} />;
  const inf = influencers?.find((i) => i.id === script.influencerId);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 text-lg font-semibold" />
              <div className="flex flex-wrap items-center gap-1.5">
                <GenerationBadge provider={script.provider} isDemo={script.isDemo} />
                {inf && <Badge variant="secondary"><InfluencerAvatar influencer={inf} size={14} /> {inf.name}</Badge>}
                <Badge variant="outline">{LANGUAGES.find((l) => l.code === script.language)?.label}</Badge>
                <Badge variant="outline">{script.duration}s</Badge>
                <Badge variant="outline">{script.tone}</Badge>
                <Badge variant="outline">{script.category}</Badge>
                <Badge variant={script.status === 'final' ? 'success' : 'outline'}>{script.status}</Badge>
                {stats && (
                  <span className={cn('text-xs', Math.abs(stats.seconds - script.duration) > script.duration * 0.25 ? 'text-amber-300' : 'text-muted-foreground')}>
                    {stats.words} words · ≈{stats.seconds}s spoken
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Topic: {script.topic}{script.targetAudience && ` · Audience: ${script.targetAudience}`}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save.mutate({})} disabled={!dirty} loading={save.isPending} variant={dirty ? 'default' : 'secondary'}><Save /> Save draft</Button>
              <Button variant="secondary" loading={toScreenplay.isPending} onClick={() => toScreenplay.mutate(undefined)}><Clapperboard /> Convert to screenplay</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreVertical /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => save.mutate({ status: script.status === 'final' ? 'draft' : 'final' })}>
                    {script.status === 'final' ? 'Mark as draft' : 'Mark as final'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => duplicate.mutate(undefined)}><Copy /> Duplicate</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => downloadUrl(`/api/scripts/${id}/export?format=txt`)}><Download /> Export .txt</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => downloadUrl(`/api/scripts/${id}/export?format=md`)}><Download /> Export .md</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => downloadUrl(`/api/scripts/${id}/export?format=json`)}><Download /> Export .json</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}><Trash2 /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {script.isDemo && script.provider !== 'sample' && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              This script contains demo template text — it was not written by an AI model and does not really understand the topic. Edit it by hand or connect an LLM in Settings and regenerate.
            </p>
          )}
        </CardContent>
      </Card>

      {SCRIPT_SECTIONS.map((sec, i) => {
        const words = sections[sec.key].split(/\s+/).filter(Boolean).length;
        return (
          <Card key={sec.key}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold">{sec.label}</p>
                    <p className="text-xs text-muted-foreground">{sec.hint} · {words} words · ≈{Math.round(words / WPS[script.language])}s</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 w-56 text-xs"
                    placeholder="Optional: how to change it…"
                    value={instructions[sec.key] ?? ''}
                    onChange={(e) => setInstructions((s) => ({ ...s, [sec.key]: e.target.value }))}
                  />
                  <Button size="sm" variant="secondary" loading={regenerating === sec.key} disabled={regen.isPending} onClick={() => regen.mutate(sec.key)}>
                    <RefreshCw /> Regenerate
                  </Button>
                </div>
              </div>
              <Textarea
                rows={sec.key === 'main' ? 7 : 3}
                value={sections[sec.key]}
                onChange={(e) => setSections((s) => (s ? { ...s, [sec.key]: e.target.value } : s))}
                className="text-[15px] leading-relaxed"
                lang={script.language}
              />
            </CardContent>
          </Card>
        );
      })}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this script?"
        description="Screenplays created from it are kept."
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}

export default function ScriptStudioPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: scripts, isLoading } = useScripts();
  const { data: influencers } = useInfluencers();
  const [q, setQ] = useState('');
  const showNew = !id || params.get('new');
  const list = (scripts ?? []).filter((s) => `${s.title} ${s.topic}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title="Script Studio"
        description="Write reel scripts in Hindi, English and Marathi for your influencers. Edit, regenerate individual sections, export, or convert them into screenplays."
        actions={<Button onClick={() => navigate('/scripts?new=1')}><Plus /> New script</Button>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit lg:sticky lg:top-4">
          <CardContent className="space-y-3 pt-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scripts" className="pl-8" />
            </div>
            <div className="max-h-[65vh] space-y-1 overflow-y-auto pr-1">
              {isLoading ? (
                <LoadingBlock className="py-6" />
              ) : list.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No scripts yet.</p>
              ) : (
                list.map((s) => {
                  const inf = influencers?.find((i) => i.id === s.influencerId);
                  return (
                    <Link
                      key={s.id}
                      to={`/scripts/${s.id}`}
                      className={cn('flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-accent/60', s.id === id && !params.get('new') && 'bg-accent')}
                    >
                      <InfluencerAvatar influencer={inf} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.language.toUpperCase()} · {s.duration}s · {timeAgo(s.updatedAt)}
                          {s.isDemo && <span className="text-amber-300"> · demo</span>}
                        </p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
        <div>
          {showNew ? (
            <NewScriptForm onCreated={(s) => navigate(`/scripts/${s.id}`)} />
          ) : id ? (
            <ScriptEditor key={id} id={id} />
          ) : (
            <EmptyState icon={<FileText />} title="Select a script" />
          )}
        </div>
      </div>
    </div>
  );
}
