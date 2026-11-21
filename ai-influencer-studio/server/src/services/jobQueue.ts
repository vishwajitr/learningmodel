import type { Job, JobType } from '../../../shared/types.js';
import { repos } from '../db/repositories.js';
import { HttpError, ProviderUnavailableError } from '../lib/errors.js';

export interface JobContext {
  progress(value: number, message?: string): Promise<void>;
}
export type JobHandler = (job: Job, ctx: JobContext) => Promise<Record<string, unknown>>;
type FailureHook = (job: Job, error: string) => Promise<void>;

const handlers = new Map<JobType, { run: JobHandler; onFail?: FailureHook }>();
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY ?? 1);
let running = 0;
let timer: NodeJS.Timeout | null = null;

export function registerHandler(type: JobType, run: JobHandler, onFail?: FailureHook) {
  handlers.set(type, { run, onFail });
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { maxAttempts?: number; message?: string } = {}) {
  const job = await repos.jobs.create({
    type,
    status: 'queued',
    progress: 0,
    message: opts.message ?? 'Queued',
    payload,
    result: null,
    error: null,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 2,
  });
  schedule();
  return job;
}

export async function retryJob(id: string) {
  const job = await repos.jobs.get(id);
  if (!job) throw new HttpError(404, 'Job not found');
  if (job.status === 'running' || job.status === 'queued') return job;
  const updated = await repos.jobs.update(id, { status: 'queued', attempts: 0, error: null, progress: 0, message: 'Retry queued', result: null });
  schedule();
  return updated!;
}

export async function cancelJob(id: string) {
  const job = await repos.jobs.get(id);
  if (!job) throw new HttpError(404, 'Job not found');
  if (job.status === 'queued') return repos.jobs.update(id, { status: 'cancelled', message: 'Cancelled' });
  return job;
}

function schedule(delay = 50) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, delay);
}

async function tick() {
  while (running < CONCURRENCY) {
    const [next] = await repos.jobs.list({ status: 'queued' }, { orderBy: 'createdAt', direction: 'asc', limit: 1 });
    if (!next) return;
    running++;
    await repos.jobs.update(next.id, { status: 'running', attempts: next.attempts + 1, message: 'Starting…' });
    void execute({ ...next, attempts: next.attempts + 1 }).finally(() => {
      running--;
      schedule();
    });
  }
}

async function execute(job: Job) {
  const handler = handlers.get(job.type);
  if (!handler) {
    await repos.jobs.update(job.id, { status: 'failed', error: `No handler for job type ${job.type}` });
    return;
  }
  const ctx: JobContext = {
    progress: async (value, message) => {
      await repos.jobs.update(job.id, { progress: Math.max(0, Math.min(1, value)), ...(message ? { message } : {}) });
    },
  };
  try {
    const result = await handler.run(job, ctx);
    await repos.jobs.update(job.id, { status: 'completed', progress: 1, result, message: 'Completed', error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unavailable = err instanceof ProviderUnavailableError;
    const retryable = !unavailable && !(err instanceof HttpError && err.status < 500) && job.attempts < job.maxAttempts;
    console.error(`[job ${job.type} ${job.id}] attempt ${job.attempts} failed:`, message);
    if (retryable) {
      await repos.jobs.update(job.id, { status: 'queued', message: `Attempt ${job.attempts} failed, retrying: ${message}`, error: message });
      schedule(2000 * job.attempts);
      return;
    }
    await repos.jobs.update(job.id, {
      status: 'failed',
      error: message,
      message: unavailable ? 'Provider unavailable' : 'Failed',
      result: err instanceof HttpError && err.setupInstructions?.length ? { setupInstructions: err.setupInstructions } : null,
    });
    await handler.onFail?.(job, message).catch(() => undefined);
  }
}

/** Resume jobs interrupted by a server restart. */
export async function startQueue() {
  for (const job of await repos.jobs.list({ status: 'running' })) {
    await repos.jobs.update(job.id, { status: 'queued', message: 'Resumed after restart' });
  }
  schedule();
}
