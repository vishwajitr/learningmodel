import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type MediaFolder = 'images' | 'uploads' | 'audio' | 'video' | 'tmp';

/** Saves a buffer under data/media/<folder>/ and returns its public URL and disk path. */
export function saveMedia(folder: MediaFolder, ext: string, data: Buffer): { url: string; filePath: string } {
  const dir = path.join(config.mediaDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext.replace(/^\./, '')}`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, data);
  return { url: `/media/${folder}/${name}`, filePath };
}

export function newMediaPath(folder: MediaFolder, ext: string): { url: string; filePath: string } {
  const dir = path.join(config.mediaDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext.replace(/^\./, '')}`;
  return { url: `/media/${folder}/${name}`, filePath: path.join(dir, name) };
}

/** Resolves a /media/... URL to a path on disk (guarding against traversal). */
export function mediaUrlToPath(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/media/')) return null;
  const resolved = path.resolve(config.mediaDir, url.slice('/media/'.length));
  if (!resolved.startsWith(path.resolve(config.mediaDir) + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

export function deleteMedia(url: string | null | undefined) {
  const p = mediaUrlToPath(url);
  if (p) fs.rmSync(p, { force: true });
}
