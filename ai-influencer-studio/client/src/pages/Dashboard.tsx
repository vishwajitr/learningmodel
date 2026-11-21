import { Link, useNavigate } from 'react-router-dom';
import {
  Activity as ActivityIcon, Clapperboard, FileText, Film, FolderKanban, ImagePlus, PenLine, Plus, Sparkles, UserPlus, Users, Video,
} from 'lucide-react';
import { useDashboard } from '@/lib/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { CharacterTypeBadge, EmptyState, ErrorState, InfluencerAvatar, StatCard } from '@/components/common';
import { timeAgo } from '@/lib/utils';

const QUICK = [
  { label: 'Create New Influencer', desc: 'Human or cartoon persona', icon: UserPlus, to: '/influencers?new=1' },
  { label: 'Write New Script', desc: 'Hook → CTA reel script', icon: PenLine, to: '/scripts?new=1' },
  { label: 'Create Screenplay', desc: 'Scene-by-scene storyboard', icon: Clapperboard, to: '/screenplays' },
  { label: 'Generate New Reel', desc: 'Voice, scenes & video', icon: Video, to: '/projects?new=1' },
];

const STATUS_VARIANT = { draft: 'outline', in_progress: 'info', rendering: 'warning', completed: 'success' } as const;

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-violet-600/20 via-[#13131b] to-blue-600/15 p-6 lg:p-8">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge variant="default" className="mb-3"><Sparkles /> AI Influencer Studio</Badge>
            <h1 className="text-3xl font-semibold tracking-tight">
              Create <span className="text-gradient">AI influencers</span> and their reels
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Design consistent characters, write natural Hindi / English / Marathi scripts, storyboard every scene and render
              9:16 reels — all on your own machine.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/projects?new=1')}><Plus /> New reel project</Button>
            <Button variant="secondary" onClick={() => navigate('/settings')}>Configure AI engines</Button>
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {isLoading || !data ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[112px]" />)
          ) : (
            <>
              <StatCard label="Influencers" value={data.totals.influencers} icon={<Users />} accent="bg-violet-500" />
              <StatCard label="Scripts" value={data.totals.scripts} icon={<FileText />} accent="bg-blue-500" />
              <StatCard label="Screenplays" value={data.totals.screenplays} icon={<Clapperboard />} accent="bg-fuchsia-500" />
              <StatCard label="Generated videos" value={data.totals.videos} icon={<Film />} accent="bg-cyan-500" />
              <StatCard label="Draft projects" value={data.totals.draftProjects} hint={`${data.totals.projects} total`} icon={<FolderKanban />} accent="bg-amber-500" />
            </>
          )}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK.map(({ label, desc, icon: Icon, to }) => (
            <Link
              key={label}
              to={to}
              className="group flex items-center gap-4 rounded-lg border bg-card/70 p-4 transition-all hover:-translate-y-0.5 hover:border-violet-500/50 hover:bg-card"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-white shadow-lg shadow-violet-900/30 transition-transform group-hover:scale-105">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent influencers</CardTitle>
              <CardDescription>Your AI personas</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild><Link to="/influencers">View all</Link></Button>
          </CardHeader>
          <CardContent>
            {!data ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
            ) : data.recentInfluencers.length === 0 ? (
              <EmptyState icon={<UserPlus />} title="No influencers yet" action={<Button asChild><Link to="/influencers?new=1">Create one</Link></Button>} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {data.recentInfluencers.map((inf) => (
                  <Link key={inf.id} to={`/influencers/${inf.id}`} className="group overflow-hidden rounded-lg border bg-muted/20 transition-colors hover:border-violet-500/50">
                    <div className="aspect-square overflow-hidden bg-muted">
                      {inf.profileImageUrl ? (
                        <img src={inf.profileImageUrl} alt={inf.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full items-center justify-center"><InfluencerAvatar influencer={inf} size={64} /></div>
                      )}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <p className="truncate text-sm font-medium">{inf.name}</p>
                      <CharacterTypeBadge type={inf.characterType} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ActivityIcon className="h-4 w-4 text-violet-400" /> Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : data.recentActivities.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-4">
                {data.recentActivities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-violet-500 ring-4 ring-card" />
                    <p className="text-sm leading-snug">{a.message}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {data && data.recentProjects.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent projects</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/projects">All projects</Link></Button>
          </CardHeader>
          <CardContent className="divide-y">
            {data.recentProjects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-violet-300">
                <div className="flex items-center gap-3">
                  <ImagePlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={STATUS_VARIANT[p.status]}>{p.status.replace('_', ' ')}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{timeAgo(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
