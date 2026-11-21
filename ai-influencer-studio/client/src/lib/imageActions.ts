import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InfluencerImage } from '@shared/types';
import { api } from './api';
import { qk, toastError } from './hooks';
import type { ImageActions } from '@/components/ImageGrid';

/** Standard gallery actions wired to the API with cache invalidation. */
export function useImageActions(influencerId: string | null | undefined): Required<ImageActions> {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['images'] });
    qc.invalidateQueries({ queryKey: qk.influencers });
    if (influencerId) qc.invalidateQueries({ queryKey: qk.influencer(influencerId) });
    qc.invalidateQueries({ queryKey: qk.dashboard });
  };
  const run = (fn: () => Promise<unknown>, msg?: string) => async () => {
    try {
      await fn();
      if (msg) toast.success(msg);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };
  return {
    onSave: (img: InfluencerImage) => void run(() => api.post(`/images/${img.id}/save`), 'Saved to gallery')(),
    onDiscard: (img: InfluencerImage) => void run(() => api.del(`/images/${img.id}`))(),
    onDelete: (img: InfluencerImage) => void run(() => api.del(`/images/${img.id}`), 'Image deleted')(),
    onSetMaster: (img: InfluencerImage) =>
      void run(() => api.post(`/influencers/${img.influencerId}/master`, { imageId: img.id }), 'Master reference updated – future generations will use this image')(),
    onSetProfile: (img: InfluencerImage) => void run(() => api.post(`/influencers/${img.influencerId}/profile`, { imageId: img.id }), 'Profile picture updated')(),
  };
}
