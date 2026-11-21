import { useState } from 'react';
import { Check, Crown, Download, Maximize2, Trash2, UserCircle, X } from 'lucide-react';
import type { InfluencerImage, InfluencerView } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GenerationBadge } from '@/components/common';
import { cn, downloadUrl } from '@/lib/utils';

export interface ImageActions {
  onSave?: (img: InfluencerImage) => void;
  onDiscard?: (img: InfluencerImage) => void;
  onSetMaster?: (img: InfluencerImage) => void;
  onSetProfile?: (img: InfluencerImage) => void;
  onDelete?: (img: InfluencerImage) => void;
}

export function ImageCard({ img, influencer, actions }: { img: InfluencerImage; influencer?: InfluencerView | null; actions: ImageActions }) {
  const [zoom, setZoom] = useState(false);
  const isMaster = influencer?.masterImageId === img.id;
  const isProfile = influencer?.profileImageId === img.id;
  const preview = img.status === 'preview';
  return (
    <div className={cn('group overflow-hidden rounded-lg border bg-card/80', preview && 'border-violet-500/50 ring-1 ring-violet-500/30')}>
      <div className="relative bg-muted" style={{ aspectRatio: `${img.width} / ${img.height}` }}>
        <img src={img.url} alt={img.prompt} loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {isMaster && <Badge variant="warning"><Crown /> Master</Badge>}
          {isProfile && <Badge variant="info"><UserCircle /> Profile</Badge>}
          {preview && <Badge variant="default">Preview – not saved</Badge>}
        </div>
        <button
          onClick={() => setZoom(true)}
          className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Enlarge"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <GenerationBadge provider={img.provider} isDemo={img.isDemo} />
          <Badge variant="outline">{img.kind.replace('_', ' ')}</Badge>
          <Badge variant="outline">{img.aspectRatio}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {preview ? (
            <>
              {actions.onSave && <Button size="sm" onClick={() => actions.onSave!(img)}><Check /> Save to gallery</Button>}
              {actions.onDiscard && <Button size="sm" variant="secondary" onClick={() => actions.onDiscard!(img)}><X /> Discard</Button>}
            </>
          ) : (
            <>
              {actions.onSetMaster && !isMaster && (
                <Button size="sm" variant="secondary" onClick={() => actions.onSetMaster!(img)} title="Use as the identity reference for all future generations">
                  <Crown /> Set master
                </Button>
              )}
              {actions.onSetProfile && !isProfile && (
                <Button size="sm" variant="secondary" onClick={() => actions.onSetProfile!(img)}><UserCircle /> Profile</Button>
              )}
              <Button size="icon-sm" variant="ghost" onClick={() => downloadUrl(img.url, `${influencer?.name ?? 'image'}-${img.id.slice(0, 6)}.png`)} aria-label="Download">
                <Download />
              </Button>
              {actions.onDelete && !isMaster && (
                <Button size="icon-sm" variant="ghost" onClick={() => actions.onDelete!(img)} aria-label="Delete"><Trash2 /></Button>
              )}
            </>
          )}
        </div>
      </div>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">Image details <GenerationBadge provider={img.provider} isDemo={img.isDemo} /></DialogTitle>
            <DialogDescription>{img.width}×{img.height} · {img.kind} {img.seed !== null && `· seed ${img.seed}`}</DialogDescription>
          </DialogHeader>
          <img src={img.url} alt="" className="max-h-[60vh] w-full rounded-md object-contain" />
          <div className="space-y-2 text-xs">
            <p><span className="text-muted-foreground">Prompt: </span>{img.prompt}</p>
            {img.negativePrompt && <p><span className="text-muted-foreground">Negative: </span>{img.negativePrompt}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ImageGrid({ images, influencer, actions, className }: { images: InfluencerImage[]; influencer?: InfluencerView | null; actions: ImageActions; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', className)}>
      {images.map((img) => <ImageCard key={img.id} img={img} influencer={influencer} actions={actions} />)}
    </div>
  );
}
