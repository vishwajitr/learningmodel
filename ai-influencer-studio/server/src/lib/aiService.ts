import { config } from '../config.js';
import { fetchWithTimeout } from './exec.js';

export interface EngineHealth {
  installed: boolean;
  ready: boolean;
  message: string;
  setup: string[];
  languages?: string[];
}

export interface AIServiceHealth {
  reachable: boolean;
  message: string;
  gpu: { available: boolean; devices: string[]; backend: string } | null;
  engines: Record<string, EngineHealth>;
}

let cache: { at: number; value: AIServiceHealth } | null = null;

/** Health of the optional Python FastAPI service (ai-service/), cached for 5 seconds. */
export async function aiServiceHealth(force = false): Promise<AIServiceHealth> {
  if (!force && cache && Date.now() - cache.at < 5000) return cache.value;
  let value: AIServiceHealth;
  try {
    const res = await fetchWithTimeout(`${config.aiServiceUrl}/health`, {}, 2000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Omit<AIServiceHealth, 'reachable' | 'message'>;
    value = { reachable: true, message: 'AI service is running', gpu: body.gpu ?? null, engines: body.engines ?? {} };
  } catch {
    value = {
      reachable: false,
      message: `AI service not reachable at ${config.aiServiceUrl}`,
      gpu: null,
      engines: {},
    };
  }
  cache = { at: Date.now(), value };
  return value;
}

export const AI_SERVICE_SETUP = [
  'cd ai-service && python3 -m venv .venv && source .venv/bin/activate',
  'pip install -r requirements.txt   (core: FastAPI)',
  'Install engine extras you need, e.g. pip install -r requirements-tts.txt',
  'uvicorn main:app --host 127.0.0.1 --port 8001',
  'Set AI_SERVICE_URL in .env if you use a different host/port.',
];

export async function aiServicePost(pathname: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(
    `${config.aiServiceUrl}${pathname}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs,
  );
}
