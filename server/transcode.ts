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
import { createReadStream, statSync } from 'fs';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogFn = (level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) => void;

interface CacheEntry {
  tmpPath: string;
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
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    fullPath,
  ]);
  const data = JSON.parse(stdout);
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const stream of data.streams || []) {
    if (stream.codec_type === 'video' && !videoCodec) videoCodec = stream.codec_name;
    if (stream.codec_type === 'audio' && !audioCodec) audioCodec = stream.codec_name;
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
          '-preset', 'fast', '-crf', '23',
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

function runFfmpeg(args: string[], log: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Drain stderr so the pipe buffer never fills (which would deadlock ffmpeg)
    let stderrBuf = '';
    proc.stderr!.setEncoding('utf8');
    proc.stderr!.on('data', (chunk: string) => {
      stderrBuf += chunk;
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000);
    });

    // Drain stdout (should be empty when writing to file, but be safe)
    proc.stdout!.resume();

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
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
        unlink(entry.tmpPath).catch(() => {});
        log('INFO', 'Cleaned up transcode cache', { key });
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit (important for tests)
  timer.unref();
}

// ─── Serve with Range support ────────────────────────────────────────────────

function serveFileWithRanges(filePath: string, req: express.Request, res: express.Response) {
  const fileStat = statSync(filePath);
  res.setHeader('Content-Type', 'video/mp4');
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
    const mode = probe.canCopyVideo && probe.canCopyAudio ? 'remux' : 'transcode';
    log('INFO', 'Transcoding file', {
      filename,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      mode,
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

  // Wait for transcoding to finish
  await entry.promise;

  serveFileWithRanges(entry.tmpPath, req, res);
}
