import type { ApiError as ApiErrorBody } from '@shared/types';

export class ApiError extends Error {
  status: number;
  code?: string;
  setupInstructions?: string[];
  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `Request failed (${status})`);
    this.status = status;
    this.code = body.code;
    this.setupInstructions = body.setupInstructions;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the API server. Is it running? (npm run dev)' });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(res.status, (data as ApiErrorBody) ?? { error: res.statusText });
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = void>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return request<T>('POST', url, fd);
  },
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
