import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Clapperboard, FileText, Film, FolderKanban, ImageIcon, LayoutDashboard, Menu, Mic, Settings, Sparkles, Users, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useJobs, useSystemStatus } from '@/lib/hooks';
import { Badge } from '@/components/ui/badge';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/influencers', label: 'Influencers', icon: Users },
  { to: '/image-studio', label: 'Image Studio', icon: ImageIcon },
  { to: '/scripts', label: 'Script Studio', icon: FileText },
  { to: '/screenplays', label: 'Screenplay Studio', icon: Clapperboard },
  { to: '/voice-studio', label: 'Voice Studio', icon: Mic },
  { to: '/video-studio', label: 'Video Studio', icon: Film },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ProviderSummary() {
  const { data } = useSystemStatus();
  if (!data) return null;
  const rows: [string, string | null, boolean][] = [
    ['Text', data.active.llm, data.active.llm === 'template-demo'],
    ['Image', data.active.image, data.active.image === 'placeholder'],
    ['Voice', data.active.tts, false],
    ['Lip sync', data.active.animation, false],
  ];
  return (
    <NavLink to="/settings" className="block rounded-lg border bg-muted/30 p-3 text-xs hover:bg-muted/50">
      <p className="mb-2 font-medium text-foreground">AI engines</p>
      <div className="space-y-1.5">
        {rows.map(([label, id, demo]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            {id ? (
              <Badge variant={demo ? 'warning' : 'success'}>{demo ? 'demo' : id}</Badge>
            ) : (
              <Badge variant="outline">not installed</Badge>
            )}
          </div>
        ))}
      </div>
    </NavLink>
  );
}

function ActiveJobs() {
  const { data } = useJobs();
  const active = (data ?? []).filter((j) => j.status === 'running' || j.status === 'queued');
  if (!active.length) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
      </span>
      {active.length} job{active.length > 1 ? 's' : ''} running · {active[0].message}
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sidebar = (
    <aside className="flex h-full w-64 flex-col gap-6 border-r bg-[#0d0d14]/95 p-4">
      <div className="flex items-center gap-2.5 px-2 pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand shadow-lg shadow-violet-900/40">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">AI Influencer</p>
          <p className="text-xs text-muted-foreground">Studio</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
                isActive && 'bg-gradient-to-r from-violet-500/20 to-blue-500/10 text-foreground shadow-[inset_2px_0_0_0_#8b5cf6]',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <ProviderSummary />
    </aside>
  );

  return (
    <div className="flex h-full bg-app-gradient">
      <div className="hidden lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/60 px-4 backdrop-blur lg:px-8">
          <button className="rounded-md p-1.5 hover:bg-accent lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex-1" />
          <ActiveJobs />
        </header>
        <main key={location.pathname.split('/')[1]} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
