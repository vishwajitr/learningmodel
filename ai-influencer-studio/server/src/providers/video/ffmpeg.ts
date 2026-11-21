import fs from 'node:fs';
import path from 'node:path';
import type { ProviderStatus } from '../../../../shared/types.js';
import { config } from '../../config.js';
import { commandExists, run } from '../../lib/exec.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { RenderRequest, RenderScene, VideoProvider } from '../types.js';

const SETUP = [
  'Install FFmpeg: sudo apt install ffmpeg   |   brew install ffmpeg   |   https://ffmpeg.org/download.html',
  'Set FFMPEG_PATH / FFPROBE_PATH in .env if the binaries are not on PATH.',
];

const srtTime = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

/** Escape a path for use inside an ffmpeg filter argument. */
const filterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

function wrapSubtitle(text: string, maxChars = 28): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\n');
}

/**
 * Composes scenes into a 9:16 MP4 with FFmpeg: per-scene clips (image with
 * camera-movement zoom, or an animated clip), audio, fades, burned or soft
 * subtitles, watermark, intro/outro cards and background music.
 * This is deterministic video editing – it does not use AI.
 */
export class FFmpegVideo implements VideoProvider {
  readonly id = 'ffmpeg';
  readonly name = 'FFmpeg compositor';
  readonly kind = 'video' as const;
  readonly isDemo = false;

  async status(): Promise<ProviderStatus> {
    const version = await commandExists(config.ffmpegPath);
    return {
      id: this.id,
      name: this.name,
      kind: 'video',
      isDemo: false,
      state: version ? 'ready' : 'not_installed',
      message: version ?? 'ffmpeg binary not found',
      setupInstructions: version ? [] : SETUP,
    };
  }

  private async probeDuration(file: string): Promise<number | null> {
    try {
      const res = await run(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
        timeoutMs: 20000,
      });
      const d = parseFloat(res.stdout.trim());
      return Number.isFinite(d) ? d : null;
    } catch {
      return null;
    }
  }

  private async ffmpeg(args: string[]) {
    const res = await run(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs: 30 * 60 * 1000 });
    if (res.code !== 0) throw new HttpError(500, `FFmpeg failed: ${res.stderr.slice(-1500)}`, 'FFMPEG_ERROR');
  }

  private zoomExpr(movement: string, frames: number): string {
    const m = movement.toLowerCase();
    const step = (0.18 / Math.max(frames, 1)).toFixed(6);
    if (m.includes('push') || m.includes('zoom in') || m.includes('tracking')) return `z='min(1+${step}*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    if (m.includes('pull') || m.includes('out')) return `z='max(1.18-${step}*on,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    if (m.includes('pan left')) return `z='1.15':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
    if (m.includes('pan right')) return `z='1.15':x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)'`;
    if (m.includes('tilt up')) return `z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${frames})'`;
    if (m.includes('tilt down')) return `z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${frames})'`;
    return `z='1.02':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  }

  /**
   * libass renders SRT with a 384x288 virtual canvas and legacy SSA alignment
   * (1-3 bottom, 5-7 top, 9-11 middle), so sizes/margins are in those units.
   */
  private subtitleFilter(srtPath: string, fontSize: number, alignment = 2, marginV = 40): string {
    const style = `FontName=${config.subtitleFont},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=3,Shadow=1,Bold=1,Alignment=${alignment},MarginV=${marginV}`;
    return `subtitles='${filterPath(srtPath)}':force_style='${style}'`;
  }

  private async renderClip(
    scene: RenderScene,
    index: number,
    req: RenderRequest,
    workDir: string,
  ): Promise<{ file: string; duration: number }> {
    const { width: W, height: H, fps } = req;
    let duration = Math.max(1, scene.duration);
    if (scene.audioPath) {
      const audioDur = await this.probeDuration(scene.audioPath);
      if (audioDur && audioDur + 0.3 > duration) duration = audioDur + 0.3;
    }
    const frames = Math.round(duration * fps);
    const out = path.join(workDir, `clip-${String(index).padStart(3, '0')}.mp4`);
    const args: string[] = [];
    const filters: string[] = [];

    if (scene.videoPath) {
      args.push('-stream_loop', '-1', '-i', scene.videoPath);
      filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1[base]`);
    } else if (scene.imagePath) {
      args.push('-loop', '1', '-framerate', String(fps), '-i', scene.imagePath);
      filters.push(
        `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=${this.zoomExpr(scene.cameraMovement, frames)}:d=${frames}:s=${W}x${H}:fps=${fps},setsar=1[base]`,
      );
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=0x1e1b4b:s=${W}x${H}:r=${fps}`);
      filters.push(`[0:v]setsar=1[base]`);
    }

    if (scene.audioPath) args.push('-i', scene.audioPath);
    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

    let v = '[base]';
    const fade = scene.transition && scene.transition.toLowerCase() !== 'cut' ? 0.3 : 0;
    if (fade) {
      filters.push(`${v}fade=t=in:st=0:d=${fade},fade=t=out:st=${(duration - fade).toFixed(2)}:d=${fade}[faded]`);
      v = '[faded]';
    }
    if (req.subtitles && req.burnSubtitles && scene.subtitle.trim()) {
      const srt = path.join(workDir, `clip-${index}.srt`);
      fs.writeFileSync(srt, `1\n${srtTime(0)} --> ${srtTime(duration)}\n${wrapSubtitle(scene.subtitle)}\n`);
      filters.push(`${v}${this.subtitleFilter(srt, 13)}[subbed]`);
      v = '[subbed]';
    }
    if (req.watermarkText.trim()) {
      const wm = path.join(workDir, `wm-${index}.srt`);
      fs.writeFileSync(wm, `1\n${srtTime(0)} --> ${srtTime(duration)}\n${req.watermarkText.trim()}\n`);
      filters.push(`${v}${this.subtitleFilter(wm, 8, 7, 12)}[wm]`);
      v = '[wm]';
    }
    filters.push(`[1:a]aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${duration.toFixed(3)}[a]`);

    await this.ffmpeg([
      ...args,
      '-filter_complex', filters.join(';'),
      '-map', v, '-map', '[a]',
      '-t', duration.toFixed(3),
      '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      out,
    ]);
    return { file: out, duration };
  }

  private async titleCard(text: string, index: number, req: RenderRequest, workDir: string) {
    const duration = 2.5;
    const srt = path.join(workDir, `card-${index}.srt`);
    fs.writeFileSync(srt, `1\n${srtTime(0)} --> ${srtTime(duration)}\n${wrapSubtitle(text, 20)}\n`);
    const out = path.join(workDir, `card-${index}.mp4`);
    await this.ffmpeg([
      '-f', 'lavfi', '-i', `gradients=s=${req.width}x${req.height}:c0=0x1e1b4b:c1=0x6d28d9:x0=0:y0=0:x1=${req.width}:y1=${req.height}:d=${duration}:r=${req.fps}`,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', `[0:v]${this.subtitleFilter(srt, 20, 10, 0)},fade=t=in:st=0:d=0.4,fade=t=out:st=${duration - 0.4}:d=0.4,setsar=1[v]`,
      '-map', '[v]', '-map', '1:a', '-t', String(duration), '-r', String(req.fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      out,
    ]);
    return { file: out, duration };
  }

  async render(req: RenderRequest): Promise<{ videoPath: string; durationSec: number }> {
    if (!(await commandExists(config.ffmpegPath))) throw new ProviderUnavailableError('FFmpeg is not installed', SETUP, this.id);
    if (!req.scenes.length) throw new HttpError(400, 'Nothing to render: the screenplay has no scenes', 'NO_SCENES');

    const workDir = fs.mkdtempSync(path.join(path.dirname(req.outputPath), 'render-'));
    try {
      const clips: { file: string; duration: number; subtitle: string }[] = [];
      const total = req.scenes.length + (req.introText ? 1 : 0) + (req.outroText ? 1 : 0) + 1;
      let step = 0;
      const tick = (msg: string) => req.onProgress?.(Math.round((++step / total) * 100) / 100, msg);

      if (req.introText.trim()) {
        clips.push({ ...(await this.titleCard(req.introText, 0, req, workDir)), subtitle: '' });
        tick('Rendered intro card');
      }
      for (let i = 0; i < req.scenes.length; i++) {
        const clip = await this.renderClip(req.scenes[i], i, req, workDir);
        clips.push({ ...clip, subtitle: req.scenes[i].subtitle });
        tick(`Rendered scene ${i + 1} of ${req.scenes.length}`);
      }
      if (req.outroText.trim()) {
        clips.push({ ...(await this.titleCard(req.outroText, 1, req, workDir)), subtitle: '' });
        tick('Rendered outro card');
      }

      const list = path.join(workDir, 'list.txt');
      fs.writeFileSync(list, clips.map((c) => `file '${c.file.replace(/'/g, "'\\''")}'`).join('\n'));
      const joined = path.join(workDir, 'joined.mp4');
      await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

      // Soft subtitle track (always useful for editing / accessibility).
      let t = 0;
      const srtEntries: string[] = [];
      clips.forEach((c) => {
        if (c.subtitle.trim()) srtEntries.push(`${srtEntries.length + 1}\n${srtTime(t)} --> ${srtTime(t + c.duration)}\n${c.subtitle.trim()}\n`);
        t += c.duration;
      });
      const fullSrt = req.outputPath.replace(/\.mp4$/, '.srt');
      fs.writeFileSync(fullSrt, srtEntries.join('\n'));

      const finalArgs = ['-i', joined];
      if (req.backgroundMusicPath && fs.existsSync(req.backgroundMusicPath)) {
        finalArgs.push('-stream_loop', '-1', '-i', req.backgroundMusicPath);
        if (req.subtitles && !req.burnSubtitles && srtEntries.length) finalArgs.push('-i', fullSrt);
        finalArgs.push(
          '-filter_complex',
          `[1:a]volume=${req.musicVolume}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
          '-map', '0:v', '-map', '[a]',
        );
        if (req.subtitles && !req.burnSubtitles && srtEntries.length) finalArgs.push('-map', '2:s', '-c:s', 'mov_text');
        finalArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k');
      } else {
        if (req.subtitles && !req.burnSubtitles && srtEntries.length) {
          finalArgs.push('-i', fullSrt, '-map', '0:v', '-map', '0:a', '-map', '1:s', '-c:s', 'mov_text');
        }
        finalArgs.push('-c:v', 'copy', '-c:a', 'copy');
      }
      finalArgs.push('-movflags', '+faststart', req.outputPath);
      await this.ffmpeg(finalArgs);
      tick('Final video written');
      return { videoPath: req.outputPath, durationSec: t };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
