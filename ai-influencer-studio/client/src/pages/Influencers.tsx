import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, ImageIcon, MoreVertical, Pencil, Plus, Search, Star, Trash2, Users } from 'lucide-react';
import type { InfluencerView } from '@shared/types';
import { LANGUAGES } from '@shared/types';
import { useApiMutation, useInfluencers, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CharacterTypeBadge, ConfirmDialog, EmptyState, ErrorState, PageHeader } from '@/components/common';
import { InfluencerFormDialog } from '@/components/InfluencerForm';

export default function InfluencersPage() {
  const { data, isLoading, error, refetch } = useInfluencers();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'human' | 'cartoon'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<InfluencerView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<InfluencerView | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (params.get('new')) {
      setEditing(null);
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const list = useMemo(
    () => (data ?? []).filter((i) => (filter === 'all' || i.characterType === filter) && i.name.toLowerCase().includes(q.toLowerCase())),
    [data, filter, q],
  );

  const duplicate = useApiMutation((id: string) => api.post<InfluencerView>(`/influencers/${id}/duplicate`), {
    invalidate: [qk.influencers],
    success: (r) => `Created ${r.name}`,
  });
  const remove = useApiMutation((id: string) => api.del(`/influencers/${id}`), {
    invalidate: [qk.influencers],
    success: 'Influencer deleted',
    onSuccess: () => setDeleting(null),
  });

  return (
    <div>
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Influencer Library"
        description="Create, edit and manage your AI influencers. Each one keeps a master reference image and appearance prompt for consistent generations."
        actions={<Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> New influencer</Button>}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="human">Human</TabsTrigger>
            <TabsTrigger value="cartoon">Cartoon</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search influencers" className="pl-8" />
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-80" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={data?.length ? 'No influencers match your filters' : 'No influencers yet'}
          description="Create a realistic human or an animated cartoon influencer to get started."
          action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Create influencer</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((inf) => (
            <div key={inf.id} className="group overflow-hidden rounded-lg border bg-card/80 transition-colors hover:border-violet-500/40">
              <Link to={`/influencers/${inf.id}`} className="block">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  {inf.profileImageUrl ? (
                    <img src={inf.profileImageUrl} alt={inf.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>
                  )}
                  {inf.isDefault && <Badge variant="warning" className="absolute left-2 top-2"><Star /> Default</Badge>}
                </div>
              </Link>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/influencers/${inf.id}`} className="block truncate font-semibold hover:text-violet-300">{inf.name}</Link>
                    <p className="text-xs text-muted-foreground">{inf.age} · {inf.gender.replace('_', '-')} · {inf.niches.join(', ') || 'No niche'}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Actions"><MoreVertical /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setEditing(inf); setFormOpen(true); }}><Pencil /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => duplicate.mutate(inf.id)}><Copy /> Duplicate</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => navigate(`/image-studio?influencer=${inf.id}`)}><ImageIcon /> Open in Image Studio</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(inf)}><Trash2 /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <CharacterTypeBadge type={inf.characterType} />
                  {inf.languages.map((l) => <Badge key={l} variant="outline">{LANGUAGES.find((x) => x.code === l)?.label}</Badge>)}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{inf.imageCount} images</span>
                  <span>{inf.scriptCount} scripts</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <InfluencerFormDialog open={formOpen} onOpenChange={setFormOpen} influencer={editing} onSaved={(r) => !editing && navigate(`/influencers/${r.id}`)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="This removes the influencer and their image gallery. Scripts and projects are kept but unlinked."
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
