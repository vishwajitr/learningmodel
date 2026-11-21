import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Crown, FileText, FolderPlus, ImageIcon, ImagePlus, Mic, Pencil, Trash2, Upload } from 'lucide-react';
import { LANGUAGES, CARTOON_STYLES, type InfluencerView, type ProjectView } from '@shared/types';
import { api } from '@/lib/api';
import { qk, useApiMutation, useInfluencer, useInfluencerImages, useScripts, useVoices } from '@/lib/hooks';
import { useImageActions } from '@/lib/imageActions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/misc';
import { CharacterTypeBadge, ConfirmDialog, EmptyState, ErrorState, GenerationBadge, LoadingBlock } from '@/components/common';
import { InfluencerFormDialog } from '@/components/InfluencerForm';
import { ImageGrid } from '@/components/ImageGrid';
import { timeAgo } from '@/lib/utils';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm">{children || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export default function InfluencerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: inf, isLoading, error, refetch } = useInfluencer(id);
  const { data: images } = useInfluencerImages(id, 'saved');
  const { data: scripts } = useScripts();
  const { data: voices } = useVoices();
  const actions = useImageActions(id);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadRole, setUploadRole] = useState<'gallery' | 'master'>('gallery');
  const [showScenes, setShowScenes] = useState(false);

  const upload = useApiMutation((file: File) => api.upload(`/influencers/${id}/upload`, file, { role: uploadRole }), {
    invalidate: [['images'], qk.influencers, qk.influencer(id ?? '')],
    success: uploadRole === 'master' ? 'Uploaded and set as master reference + profile picture' : 'Image uploaded to gallery',
  });
  const duplicate = useApiMutation(() => api.post<InfluencerView>(`/influencers/${id}/duplicate`), {
    invalidate: [qk.influencers],
    success: (r) => `Created ${r.name}`,
    onSuccess: (r) => navigate(`/influencers/${r.id}`),
  });
  const remove = useApiMutation(() => api.del(`/influencers/${id}`), {
    invalidate: [qk.influencers],
    success: 'Influencer deleted',
    onSuccess: () => navigate('/influencers'),
  });
  const newProject = useApiMutation(
    () => api.post<ProjectView>('/projects', { name: `${inf?.name} – new reel`, influencerId: id }),
    { invalidate: [qk.projects], success: 'Project created', onSuccess: (p) => navigate(`/projects/${p.id}`) },
  );

  if (isLoading) return <LoadingBlock />;
  if (error || !inf) return <ErrorState error={error ?? new Error('Influencer not found')} onRetry={() => refetch()} />;

  const voice = voices?.find((v) => v.id === inf.voiceProfileId);
  const infScripts = (scripts ?? []).filter((s) => s.influencerId === inf.id);
  const masterImg = images?.find((i) => i.id === inf.masterImageId);

  const pickFile = (role: 'gallery' | 'master') => {
    setUploadRole(role);
    fileRef.current?.click();
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild><Link to="/influencers"><ArrowLeft /> Influencers</Link></Button>

      <div className="flex flex-col gap-6 rounded-xl border bg-gradient-to-br from-violet-600/10 via-card to-blue-600/10 p-6 md:flex-row">
        <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl border bg-muted">
          {inf.profileImageUrl ? <img src={inf.profileImageUrl} alt={inf.name} className="h-full w-full object-cover" /> : <ImageIcon className="m-auto mt-16 h-8 w-8 text-muted-foreground" />}
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{inf.name}</h1>
            <CharacterTypeBadge type={inf.characterType} />
            {inf.cartoonStyle && <Badge variant="outline">{CARTOON_STYLES.find((c) => c.value === inf.cartoonStyle)?.label}</Badge>}
            {inf.isDefault && <Badge variant="warning">Default influencer</Badge>}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{inf.personality}</p>
          <div className="flex flex-wrap gap-1.5">
            {inf.niches.map((n) => <Badge key={n} variant="secondary">{n}</Badge>)}
            {inf.languages.map((l) => <Badge key={l} variant="outline">{LANGUAGES.find((x) => x.code === l)?.label}{l === inf.primaryLanguage ? ' (primary)' : ''}</Badge>)}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
            <Button size="sm" variant="secondary" asChild><Link to={`/image-studio?influencer=${inf.id}`}><ImagePlus /> Image Studio</Link></Button>
            <Button size="sm" variant="secondary" asChild><Link to={`/scripts?new=1&influencer=${inf.id}`}><FileText /> Write script</Link></Button>
            <Button size="sm" variant="secondary" loading={newProject.isPending} onClick={() => newProject.mutate(undefined)}><FolderPlus /> New reel project</Button>
            <Button size="sm" variant="ghost" loading={duplicate.isPending} onClick={() => duplicate.mutate(undefined)}><Copy /> Duplicate</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Character sheet</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Detail label="Gender / age">{inf.gender.replace('_', '-')} · ~{inf.age}</Detail>
            <Detail label="Ethnicity">{inf.ethnicity}</Detail>
            <Detail label="Appearance">{inf.appearance}</Detail>
            <Detail label="Clothing style">{inf.clothingStyle}</Detail>
            <Detail label="Speaking style">{inf.speakingStyle}</Detail>
            <Detail label="Accent · pitch · speed">{inf.accent || '—'} · {inf.pitch > 0 ? '+' : ''}{inf.pitch} st · {inf.speakingSpeed.toFixed(2)}×</Detail>
            <Detail label="Background story"><span className="whitespace-pre-wrap">{inf.backgroundStory}</span></Detail>
            <Detail label="Master appearance prompt"><span className="font-mono text-xs text-slate-300">{inf.appearancePrompt}</span></Detail>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-400" /> Master reference</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {masterImg ? (
                <>
                  <img src={masterImg.url} alt="" className="aspect-square w-full rounded-md object-cover" />
                  <GenerationBadge provider={masterImg.provider} isDemo={masterImg.isDemo} />
                  {masterImg.isDemo && (
                    <p className="text-xs text-amber-300/90">
                      This is placeholder art. Upload a photo/render or generate one in the Image Studio and set it as master so image models can keep the identity consistent.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No master image yet.</p>
              )}
              <Button size="sm" variant="secondary" className="w-full" loading={upload.isPending && uploadRole === 'master'} onClick={() => pickFile('master')}>
                <Upload /> Upload new master image
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Mic className="h-4 w-4 text-violet-400" /> Voice</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {voice ? (
                <>
                  <p className="font-medium">{voice.name}</p>
                  <p className="text-xs text-muted-foreground">{voice.style.replace('_', ' ')} · {LANGUAGES.find((l) => l.code === voice.language)?.label} · {voice.accent}</p>
                </>
              ) : (
                <p className="text-muted-foreground">No voice assigned.</p>
              )}
              <Button size="sm" variant="secondary" asChild className="w-full"><Link to={`/voice-studio?influencer=${inf.id}`}>Manage in Voice Studio</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Gallery</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showScenes} onCheckedChange={setShowScenes} /> Scene frames
            </label>
            <Button size="sm" variant="secondary" loading={upload.isPending && uploadRole === 'gallery'} onClick={() => pickFile('gallery')}><Upload /> Upload</Button>
            <Button size="sm" asChild><Link to={`/image-studio?influencer=${inf.id}`}><ImagePlus /> Generate</Link></Button>
          </div>
        </CardHeader>
        <CardContent>
          {images && images.filter((i) => showScenes || i.kind !== 'scene').length > 0 ? (
            <ImageGrid images={images.filter((i) => showScenes || i.kind !== 'scene')} influencer={inf} actions={actions} />
          ) : (
            <EmptyState icon={<ImageIcon />} title="Gallery is empty" description="Generate images in the Image Studio or upload your own." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Scripts</CardTitle></CardHeader>
        <CardContent>
          {infScripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scripts for {inf.name} yet.</p>
          ) : (
            <div className="divide-y">
              {infScripts.map((s) => (
                <Link key={s.id} to={`/scripts/${s.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-violet-300">
                  <span className="truncate text-sm">{s.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <GenerationBadge provider={s.provider} isDemo={s.isDemo} />
                    <span className="text-xs text-muted-foreground">{timeAgo(s.updatedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = '';
        }}
      />
      <InfluencerFormDialog open={editOpen} onOpenChange={setEditOpen} influencer={inf} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${inf.name}?`}
        description="The influencer and their gallery will be removed. Scripts and projects stay but are unlinked."
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}
