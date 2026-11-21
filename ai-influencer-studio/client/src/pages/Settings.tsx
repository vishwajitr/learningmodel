import { Cpu, Database, RefreshCw, Server, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProviderKind } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useJobs, useSystemStatus } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorState, LoadingBlock, PageHeader, ProviderStateBadge, SetupInstructions } from '@/components/common';
import { timeAgo } from '@/lib/utils';

const KINDS: { kind: ProviderKind; title: string; description: string; interfaceName: string }[] = [
  { kind: 'llm', title: 'Language model', description: 'Script writing, screenplay conversion, captions', interfaceName: 'LLMProvider' },
  { kind: 'image', title: 'Image generation', description: 'Influencer images and scene frames', interfaceName: 'ImageProvider' },
  { kind: 'tts', title: 'Text-to-speech', description: 'Voices for Hindi, Marathi and English', interfaceName: 'TTSProvider' },
  { kind: 'animation', title: 'Avatar animation / lip sync', description: 'Talking heads and cartoon lip sync', interfaceName: 'AvatarAnimationProvider' },
  { kind: 'video', title: 'Video composition', description: 'Combining scenes, subtitles, music', interfaceName: 'VideoProvider' },
];

export default function SettingsPage() {
  const { data, isLoading, error, refetch, isFetching } = useSystemStatus();
  const { data: jobs } = useJobs();
  const qc = useQueryClient();
  const setProvider = useApiMutation(({ kind, provider }: { kind: ProviderKind; provider: string }) => api.put(`/system/config/${kind}`, { provider }), {
    invalidate: [qk.status], success: 'Provider updated',
  });
  const retry = useApiMutation((jobId: string) => api.post(`/jobs/${jobId}/retry`), { invalidate: [qk.jobs], success: 'Job re-queued' });

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" />}
        title="Settings & models"
        description="Every AI capability goes through a replaceable provider. Statuses below are live checks — nothing is reported as ready unless it really is."
        actions={<Button variant="secondary" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: qk.status })}><RefreshCw /> Re-check</Button>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-3 pt-5">
            <Cpu className="mt-0.5 h-5 w-5 text-violet-400" />
            <div>
              <p className="text-sm font-medium">GPU</p>
              <p className="text-xs text-muted-foreground">{data.gpu.message}</p>
              {data.gpu.devices.map((d) => <Badge key={d} variant="success" className="mt-1.5">{d}</Badge>)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 pt-5">
            <Server className="mt-0.5 h-5 w-5 text-violet-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Python AI service</p>
              <p className="text-xs text-muted-foreground">{data.aiService.message}</p>
              <Badge variant={data.aiService.reachable ? 'success' : 'outline'} className="mt-1.5">{data.aiService.url}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 pt-5">
            <Database className="mt-0.5 h-5 w-5 text-violet-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium">FFmpeg</p>
              <p className="truncate text-xs text-muted-foreground">{data.ffmpeg.version ?? 'Not installed'}</p>
              <Badge variant={data.ffmpeg.available ? 'success' : 'danger'} className="mt-1.5">{data.ffmpeg.available ? 'available' : 'missing'}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {KINDS.map(({ kind, title, description, interfaceName }) => {
        const providers = data.providers.filter((p) => p.kind === kind);
        const cfg = data.configurations.find((c) => c.kind === kind);
        return (
          <Card key={kind}>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">{title} <Badge variant="outline" className="font-mono">{interfaceName}</Badge></CardTitle>
                <CardDescription>{description} · active: <span className="text-foreground">{data.active[kind] ?? 'none'}</span></CardDescription>
              </div>
              {kind !== 'video' && (
                <NativeSelect className="w-60" value={cfg?.provider ?? 'auto'} onChange={(e) => setProvider.mutate({ kind, provider: e.target.value })}>
                  <option value="auto">Auto – first ready provider</option>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {providers.map((p) => (
                <div key={p.id} className="space-y-2 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{p.id}</p>
                    </div>
                    <ProviderStateBadge state={p.state} />
                  </div>
                  <p className="text-xs text-muted-foreground">{p.message}</p>
                  {p.setupInstructions.length > 0 && <SetupInstructions steps={p.setupInstructions} />}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Generation queue</CardTitle>
          <CardDescription>Jobs run in the background with progress tracking and automatic retry for transient errors.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {!jobs?.length ? <p className="py-4 text-sm text-muted-foreground">No jobs yet.</p> : jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm"><span className="font-mono text-xs text-muted-foreground">{j.type}</span> · {j.message}</p>
                {j.error && <p className="truncate text-xs text-red-300">{j.error}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : 'info'}>{j.status}{j.status === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}</Badge>
                <span className="text-xs text-muted-foreground">{timeAgo(j.updatedAt)} · try {j.attempts}/{j.maxAttempts}</span>
                {j.status === 'failed' && <Button size="sm" variant="ghost" onClick={() => retry.mutate(j.id)}><RefreshCw /> Retry</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 pt-5 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <p>
            API keys live only in the server’s <code className="text-foreground">.env</code> file and are never sent to the browser. Provider selection here is stored in the
            database (<code className="text-foreground">model_configurations</code>); model URLs and names come from environment variables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
