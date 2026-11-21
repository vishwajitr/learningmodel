import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  DashboardStats, GeneratedAudio, InfluencerImage, InfluencerView, Job, ProjectView, ScreenplayView, Script, SystemStatus, VoiceProfile,
} from '@shared/types';
import { api, ApiError, errorMessage } from './api';

export const qk = {
  dashboard: ['dashboard'] as const,
  influencers: ['influencers'] as const,
  influencer: (id: string) => ['influencers', id] as const,
  images: (influencerId: string, status?: string) => ['images', influencerId, status ?? 'all'] as const,
  scripts: ['scripts'] as const,
  script: (id: string) => ['scripts', id] as const,
  screenplays: ['screenplays'] as const,
  screenplay: (id: string) => ['screenplays', id] as const,
  voices: ['voices'] as const,
  audio: (filter: Record<string, string>) => ['audio', filter] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  status: ['system-status'] as const,
  jobs: ['jobs'] as const,
};

export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<DashboardStats>('/system/dashboard') });
export const useInfluencers = () => useQuery({ queryKey: qk.influencers, queryFn: () => api.get<InfluencerView[]>('/influencers') });
export const useInfluencer = (id?: string | null) =>
  useQuery({ queryKey: qk.influencer(id ?? ''), queryFn: () => api.get<InfluencerView>(`/influencers/${id}`), enabled: Boolean(id) });
export const useInfluencerImages = (id?: string | null, status?: 'saved' | 'preview') =>
  useQuery({
    queryKey: qk.images(id ?? '', status),
    queryFn: () => api.get<InfluencerImage[]>(`/influencers/${id}/images${status ? `?status=${status}` : ''}`),
    enabled: Boolean(id),
  });
export const useScripts = () => useQuery({ queryKey: qk.scripts, queryFn: () => api.get<Script[]>('/scripts') });
export const useScript = (id?: string | null) =>
  useQuery({ queryKey: qk.script(id ?? ''), queryFn: () => api.get<Script>(`/scripts/${id}`), enabled: Boolean(id) });
export const useScreenplays = () => useQuery({ queryKey: qk.screenplays, queryFn: () => api.get<ScreenplayView[]>('/screenplays') });
export const useScreenplay = (id?: string | null) =>
  useQuery({ queryKey: qk.screenplay(id ?? ''), queryFn: () => api.get<ScreenplayView>(`/screenplays/${id}`), enabled: Boolean(id) });
export const useVoices = () => useQuery({ queryKey: qk.voices, queryFn: () => api.get<VoiceProfile[]>('/voices') });
export const useAudio = (filter: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: qk.audio(filter),
    queryFn: () => api.get<GeneratedAudio[]>(`/voices/audio/list?${new URLSearchParams(filter)}`),
    enabled,
  });
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => api.get<ProjectView[]>('/projects') });
export const useProject = (id?: string | null) =>
  useQuery({ queryKey: qk.project(id ?? ''), queryFn: () => api.get<ProjectView>(`/projects/${id}`), enabled: Boolean(id) });
export const useSystemStatus = () =>
  useQuery({ queryKey: qk.status, queryFn: () => api.get<SystemStatus>('/system/status'), staleTime: 15_000 });
export const useJobs = () => useQuery({ queryKey: qk.jobs, queryFn: () => api.get<Job[]>('/jobs?limit=30'), refetchInterval: 3000 });

/** Generic mutation that toasts errors (with setup hints) and invalidates query keys on success. */
export function useApiMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string | null); onSuccess?: (r: TResult, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r, v);
    },
    onError: (err) => toastError(err),
  });
}

export function toastError(err: unknown) {
  if (err instanceof ApiError && err.setupInstructions?.length) {
    toast.error(err.message, { description: 'Open Settings → Models for setup instructions.', duration: 8000 });
  } else toast.error(errorMessage(err));
}

/** Polls a job until it finishes, then invalidates the given keys and fires callbacks once. */
export function useJob(
  jobId: string | null | undefined,
  opts: { invalidate?: QueryKey[]; onDone?: (job: Job) => void; onFail?: (job: Job) => void } = {},
) {
  const qc = useQueryClient();
  const handled = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'completed' || s === 'failed' || s === 'cancelled' ? false : 1000;
    },
  });
  const job = query.data;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!job) return;
    if (job.status === 'queued' || job.status === 'running') {
      handled.current = null; // allow callbacks again after a retry
      return;
    }
    if (handled.current === job.id + job.status) return;
    if (job.status === 'completed' || job.status === 'failed') {
      handled.current = job.id + job.status;
      for (const key of optsRef.current.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      qc.invalidateQueries({ queryKey: qk.jobs });
      if (job.status === 'completed') optsRef.current.onDone?.(job);
      else optsRef.current.onFail?.(job);
    }
  }, [job, qc]);
  return job;
}
