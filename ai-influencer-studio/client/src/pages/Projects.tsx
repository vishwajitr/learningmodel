import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, FolderKanban, MoreVertical, Plus, Trash2 } from 'lucide-react';
import type { ProjectView } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useInfluencers, useProjects, useScreenplays, useScripts } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, EmptyState, ErrorState, InfluencerAvatar, LoadingBlock, PageHeader } from '@/components/common';
import { timeAgo } from '@/lib/utils';

export const STATUS_VARIANT = { draft: 'outline', in_progress: 'info', rendering: 'warning', completed: 'success' } as const;

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { data: influencers } = useInfluencers();
  const { data: scripts } = useScripts();
  const { data: screenplays } = useScreenplays();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [influencerId, setInfluencerId] = useState('');
  const [scriptId, setScriptId] = useState('');
  const [screenplayId, setScreenplayId] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) { setName(''); setDescription(''); setScriptId(''); setScreenplayId(''); setTouched(false); setInfluencerId(influencers?.[0]?.id ?? ''); }
  }, [open, influencers]);
  const create = useApiMutation(
    () => api.post<ProjectView>('/projects', { name, description, influencerId: influencerId || null, scriptId: scriptId || null, screenplayId: screenplayId || null }),
    { invalidate: [qk.projects], success: 'Project created', onSuccess: (p) => navigate(`/projects/${p.id}`) },
  );
  const nameError = touched && !name.trim() ? 'Project name is required' : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reel project</DialogTitle>
          <DialogDescription>A project ties together an influencer, script, screenplay, generated media and the final video.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Project name" error={nameError}><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} placeholder="e.g. Monsoon skincare tips" /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Influencer" hint="Pick Aanya (human) or Tara (cartoon), or your own">
            <NativeSelect value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
              <option value="">— none —</option>
              {influencers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.characterType}){i.isDefault ? ' · default' : ''}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Existing script (optional)">
              <NativeSelect value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">— later —</option>
                {scripts?.filter((s) => !influencerId || s.influencerId === influencerId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Existing screenplay (optional)">
              <NativeSelect value={screenplayId} onChange={(e) => setScreenplayId(e.target.value)}>
                <option value="">— later —</option>
                {screenplays?.filter((s) => !scriptId || s.scriptId === scriptId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </NativeSelect>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => { setTouched(true); if (name.trim()) create.mutate(undefined); }}>Create project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useProjects();
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProjectView | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (params.get('new')) { setOpen(true); params.delete('new'); setParams(params, { replace: true }); }
  }, [params, setParams]);
  const duplicate = useApiMutation((id: string) => api.post<ProjectView>(`/projects/${id}/duplicate`), {
    invalidate: [qk.projects], success: 'Project duplicated', onSuccess: (p) => navigate(`/projects/${p.id}`),
  });
  const remove = useApiMutation((id: string) => api.del(`/projects/${id}`), { invalidate: [qk.projects], success: 'Project deleted', onSuccess: () => setDeleting(null) });
  const list = (data ?? []).filter((p) => filter === 'all' || p.status === filter);

  return (
    <div>
      <PageHeader
        icon={<FolderKanban className="h-5 w-5" />}
        title="Projects"
        description="Every reel is a project: influencer → script → screenplay → scene images → voice audio → video scenes → final video. Save and continue any time."
        actions={<Button onClick={() => setOpen(true)}><Plus /> New project</Button>}
      />
      <Tabs value={filter} onValueChange={setFilter} className="mb-5">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="in_progress">In progress</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : !list.length ? (
        <EmptyState icon={<FolderKanban />} title="No projects here" action={<Button onClick={() => setOpen(true)}><Plus /> New project</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const scenes = p.screenplay?.scenes.length ?? 0;
            const steps = [Boolean(p.influencer), Boolean(p.script), Boolean(p.screenplay), p.sceneImageCount > 0, p.audio.some((a) => a.status === 'completed'), Boolean(p.finalVideo)];
            return (
              <div key={p.id} className="group rounded-lg border bg-card/80 p-4 transition-colors hover:border-violet-500/40">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/projects/${p.id}`} className="min-w-0">
                    <p className="truncate font-medium group-hover:text-violet-300">{p.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{p.description || 'No description'}</p>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Actions"><MoreVertical /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => duplicate.mutate(p.id)}><Copy /> Duplicate</DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setDeleting(p)}><Trash2 /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <InfluencerAvatar influencer={p.influencer} size={24} />
                  <span className="text-sm">{p.influencer?.name ?? 'No influencer'}</span>
                  <Badge variant={STATUS_VARIANT[p.status]} className="ml-auto">{p.status.replace('_', ' ')}</Badge>
                </div>
                <div className="mt-3 flex gap-1">
                  {steps.map((done, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${done ? 'bg-brand' : 'bg-muted'}`} />)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{scenes} scenes · updated {timeAgo(p.updatedAt)}</p>
              </div>
            );
          })}
        </div>
      )}
      <NewProjectDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Generated audio and videos of this project are deleted. Scripts and screenplays are kept."
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
