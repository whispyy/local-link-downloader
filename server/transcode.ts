/**
 * server/transcode.ts
 *
 * Video transcoding service: probes codecs, transcodes to browser-compatible
 * H.264+AAC MP4, caches results on disk, and serves them with full
 * Range-request support (required by Safari).
 */

import express from 'express';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream, statSync, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogFn = (level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) => void;

interface CacheEntry {
  /** null = file is already compatible, serve original directly */
  tmpPath: string | null;
  ready: boolean;
  promise: Promise<void>;
  lastAccess: number;
}

// ─── Codec detection ─────────────────────────────────────────────────────────

/** Video codecs that all browsers (including Safari) can play inside MP4 */
const SAFE_VIDEO_CODECS = new Set(['h264']);

/** Audio codecs that all browsers (including Safari) can play inside MP4 */
const SAFE_AUDIO_CODECS = new Set(['aac', 'mp3']);

interface ProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  canCopyVideo: boolean;
  canCopyAudio: boolean;
}

export async function probeFile(fullPath: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    const result = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      fullPath,
    ], { timeout: 15_000 });
    stdout = result.stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffprobe failed: ${msg}`);
  }

  let data: { streams?: Array<{ codec_type?: string; codec_name?: string }> };
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe returned invalid JSON');
  }

  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const stream of data.streams || []) {
    if (stream.codec_type === 'video' && !videoCodec) videoCodec = stream.codec_name ?? null;
    if (stream.codec_type === 'audio' && !audioCodec) audioCodec = stream.codec_name ?? null;
  }
  return {
    videoCodec,
    audioCodec,
    canCopyVideo: videoCodec !== null && SAFE_VIDEO_CODECS.has(videoCodec),
    canCopyAudio: audioCodec === null || SAFE_AUDIO_CODECS.has(audioCodec),
  };
}

// ─── Transcode ───────────────────────────────────────────────────────────────

function buildFfmpegArgs(inputPath: string, outputPath: string, probe: ProbeResult): string[] {
  return [
    '-i', inputPath,
    // Only take first video + first audio track; skip subs/data/attachments
    '-map', '0:v:0', '-map', '0:a:0?',
    // Video
    ...(probe.canCopyVideo
      ? ['-c:v', 'copy']
      : [
          '-c:v', 'libx264',
          // Baseline profile = widest Safari / iOS / older-device support
          '-profile:v', 'baseline', '-level', '3.1',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast', '-crf', '23',
          '-threads', '2',
        ]),
    // Audio
    ...(probe.canCopyAudio
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k']),
    // Put moov atom at the start so Safari can play immediately
    '-movflags', '+faststart',
    '-y', outputPath,
  ];
}

/** Max transcode time: 10 minutes. Prevents hanging on corrupted files. */
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

function runFfmpeg(args: string[], log: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    // killed flag prevents double-rejection: timer rejects first, then close fires but is suppressed
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out (exceeded 10 minutes)'));
    }, FFMPEG_TIMEOUT_MS);

    // Drain stderr so the pipe buffer never fills (which would deadlock ffmpeg)
    let stderrBuf = '';
    proc.stderr!.setEncoding('utf8');
    proc.stderr!.on('data', (chunk: string) => {
      stderrBuf += chunk;
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000);
    });

    // Drain stdout (should be empty when writing to file, but be safe)
    proc.stdout!.resume();

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return; // already rejected by timeout
      if (code === 0) {
        resolve();
      } else {
        const msg = `ffmpeg exited with code ${code}`;
        log('WARN', msg, { stderr: stderrBuf.slice(-1000) });
        reject(new Error(`${msg}: ${stderrBuf.slice(-500)}`));
      }
    });
  });
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map<string, CacheEntry>();

export function startCacheCleanup(log: LogFn) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.ready && now - entry.lastAccess > CACHE_TTL_MS) {
        cache.delete(key);
        if (entry.tmpPath) unlink(entry.tmpPath).catch(() => {});
        log('INFO', 'Cleaned up transcode cache', { key });
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit (important for tests)
  timer.unref();
}

// ─── Serve with Range support ────────────────────────────────────────────────

export function serveFileWithRanges(
  filePath: string,
  req: express.Request,
  res: express.Response,
  contentType = 'video/mp4',
) {
  if (!existsSync(filePath)) {
    if (!res.headersSent) res.status(404).json({ error: 'File not found' });
    return;
  }
  const fileStat = statSync(filePath);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Accept-Ranges', 'bytes');

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileStat.size - 1;
      if (start >= fileStat.size || end >= fileStat.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileStat.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.setHeader('Content-Length', fileStat.size);
  createReadStream(filePath).pipe(res);
}

// ─── Public: handle a stream request ─────────────────────────────────────────

export async function handleStreamRequest(
  fullPath: string,
  filename: string,
  req: express.Request,
  res: express.Response,
  log: LogFn,
): Promise<void> {
  const cacheKey = path.resolve(fullPath);
  let entry = cache.get(cacheKey);

  if (!entry) {
    const probe = await probeFile(fullPath);

    // If file is already a compatible MP4, cache a sentinel and serve original directly.
    // We require MP4 specifically: Safari/iOS cannot play MKV, AVI, WebM, etc. even
    // when the codecs are h264+aac. Non-MP4 files must be remuxed into an MP4 container.
    const isAlreadyMp4 = path.extname(fullPath).toLowerCase() === '.mp4';
    if (probe.canCopyVideo && probe.canCopyAudio && isAlreadyMp4) {
      log('INFO', 'Serving original (already compatible MP4)', {
        filename,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
      });
      cache.set(cacheKey, { tmpPath: null, ready: true, promise: Promise.resolve(), lastAccess: Date.now() });
      serveFileWithRanges(fullPath, req, res, 'video/mp4');
      return;
    }

    log('INFO', 'Transcoding file', {
      filename,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
    });

    const tmpPath = path.join(os.tmpdir(), `lld-${randomUUID()}.mp4`);
    const args = buildFfmpegArgs(fullPath, tmpPath, probe);
    const promise = runFfmpeg(args, log);

    entry = { tmpPath, ready: false, promise, lastAccess: Date.now() };
    cache.set(cacheKey, entry);

    promise.then(() => {
      entry!.ready = true;
      log('INFO', 'Transcode complete', { filename, tmpPath });
    }).catch(() => {
      cache.delete(cacheKey);
      unlink(tmpPath).catch(() => {});
    });
  }

  entry.lastAccess = Date.now();

  // Sentinel: file is already a compatible MP4, serve original directly
  if (entry.tmpPath === null) {
    serveFileWithRanges(fullPath, req, res, 'video/mp4');
    return;
  }

  // Wait for transcoding to finish
  await entry.promise;

  // Re-check: a concurrent failure may have deleted the cache entry and unlinked
  // tmpPath between when this caller retrieved the entry and now.
  if (!cache.has(cacheKey)) {
    throw new Error('Transcode failed (entry evicted during concurrent request)');
  }

  serveFileWithRanges(entry.tmpPath, req, res);
}
