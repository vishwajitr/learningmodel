import type { NextFunction, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { HttpError } from './errors.js';

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      code: 'VALIDATION_ERROR',
      details: err.issues,
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, setupInstructions: err.setupInstructions, details: err.details });
  }
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 404 ? 'Not found' : (err as Error).message, code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST' });
  }
  console.error(err);
  return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error', code: 'INTERNAL' });
}

export function extFromMime(mime: string, fallback: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  };
  return map[mime] ?? fallback;
}
