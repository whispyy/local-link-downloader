/**
 * server/app.ts
 *
 * Pure Express application factory.
 * Calling buildApp() returns a configured Express app WITHOUT starting a
 * network listener, which makes it trivially testable with supertest.
 *
 * server/index.ts is the only place that calls app.listen().
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { constants as fsConstants, createWriteStream, existsSync, mkdirSync } from 'fs';
import { writeFile, readFile, appendFile, unlink, readdir, stat, statfs, rename, copyFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { handleStreamRequest, serveFileWithRanges, startCacheCleanup, getTranscodeStatus } from './transcode';
import { buildUsageTracker } from './usage';
import { notifyDiscord, notifyDiscordError, formatBytes } from './notifier';
import { isAuthEnabled, createSession, isValidSession, verifyPassword } from './auth';
import { startAutoClean, loadRulesSync, saveRules, type AutoCleanHandle } from './autoclean';
import {
  runYtdlp, fetchVideoTitle, fetchPlaylistTitle,
  loadPlaylistsSync, savePlaylists,
  startPlaylistSync,
  type Playlist, type PlaylistSyncHandle,
} from './ytdlp';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DownloadJob {
  id: string;
  url: string;
  folderKey: string;
  filename: string;
  destPath: string;
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';
  message?: string;
  totalBytes?: number;
  downloadedBytes?: number;
  createdAt: string;
  updatedAt: string;
  abortController?: AbortController;
  // Torrent-specific
  type?: 'http' | 'torrent' | 'ytdlp';
  peers?: number;
  downloadSpeed?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  torrentRef?: any;
  // yt-dlp specific
  ytdlpPercent?: number;
  ytdlpSpeed?: string;
  ytdlpEta?: string;
  ytdlpPhase?: 'downloading' | 'postprocessing';
  videoId?: string;
  playlistId?: string;
}

// ─── WebTorrent client (lazy singleton) ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wtClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWTClient(): Promise<any> {
  if (!_wtClient) {
    // Dynamic import — webtorrent is ESM-only (top-level await).
    // Use Function to prevent ts-node/CJS from converting import() to require().
    const dynamicImport = new Function('mod', 'return import(mod)') as (mod: string) => Promise<{ default: new (opts: Record<string, unknown>) => unknown }>;
    const { default: WTC } = await dynamicImport('webtorrent');
    // utp: false disables the utp-native addon (a compiled binary that segfaults
    // on platform/arch mismatches between build and runtime environments).
    // Pure TCP is used instead — functionally identical for downloading.
    _wtClient = new WTC({ utp: false });
  }
  return _wtClient;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Returns a log function bound to the LOG_DIR/LOG_FILE resolved at call time
 * from process.env.  Called inside buildApp() so each instance picks up the
 * env values that were set before buildApp() was invoked (important for tests).
 */
function makeLogger() {
  const LOG_DIR = process.env.LOG_DIR || './logs';
  const LOG_FILE = path.join(LOG_DIR, 'downloads.log');
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return function log(level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    const line = `[${timestamp}] [${level}] ${message}${metaStr}\n`;
    process.stdout.write(line);
    if (level === 'ERROR') notifyDiscordError(message, meta);
    appendFile(LOG_FILE, line).catch(() => {});
  };
}



// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseFolderMapping(downloadFoldersEnv: string): Map<string, string> {
  const mapping = new Map<string, string>();
  if (!downloadFoldersEnv) return mapping;
  const pairs = downloadFoldersEnv.split(';');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const key = pair.substring(0, colonIdx).trim();
    const folderPath = pair.substring(colonIdx + 1).trim();
    if (key && folderPath) mapping.set(key, folderPath);
  }
  return mapping;
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
}

/** Validates that a URL is external (http/https, not internal IP). Returns parsed URL or error string. */
export function validateExternalUrl(raw: string): { url: URL } | { error: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { error: 'Invalid URL format' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Only HTTP and HTTPS protocols are allowed' };
  }
  if (isInternalIP(parsed.hostname)) {
    return { error: 'Internal/private IP addresses are not allowed' };
  }
  return { url: parsed };
}

/** Returns an error message string if the filename fails the allowlist, or null if it passes. */
export function validateExtension(filename: string, allowedExtensions: string[]): string | null {
  if (allowedExtensions.length === 0) return null;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return 'File has no extension. An extension is required.';
  const fileExt = filename.substring(dotIdx).toLowerCase();
  if (!allowedExtensions.includes(fileExt)) {
    return `File extension ${fileExt} is not allowed. Allowed: ${allowedExtensions.join(', ')}`;
  }
  return null;
}

export function isUnsafeFilename(filename: string): boolean {
  return !filename || filename.includes('..') || filename.includes('/') || filename.includes('\\');
}

/** Validates a subpath query param. Returns error message or null if valid. */
export function validateSubpath(subpath: string): string | null {
  if (subpath === '') return null;
  if (subpath.includes('\\')) return 'Backslashes not allowed';
  if (subpath.includes('..')) return 'Path traversal not allowed';
  const segments = subpath.split('/');
  if (segments.some(s => s === '')) return 'Empty path segment';
  if (segments.length > 2) return 'Max depth of 2 exceeded';
  return null;
}

/** Joins folderPath + subpath and verifies the result stays inside folderPath. */
export function resolveSubpath(folderPath: string, subpath: string): { resolved: string; error?: string } {
  const target = path.join(folderPath, subpath);
  const resolvedFolder = path.resolve(folderPath);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedFolder && !resolvedTarget.startsWith(resolvedFolder + path.sep)) {
    return { resolved: '', error: 'Path traversal detected' };
  }
  return { resolved: resolvedTarget };
}

type ResolveFilePathOk = { fullPath: string };
type ResolveFilePathErr = { error: string; status: number };

/** Validates folderKey + filename + subpath and resolves to a safe absolute path. */
function resolveFilePath(
  folderKey: string,
  filename: string,
  subpath: string,
  folderMapping: Map<string, string>,
): ResolveFilePathOk | ResolveFilePathErr {
  if (!folderMapping.has(folderKey)) {
    return { error: `Invalid folder key: ${folderKey}`, status: 400 };
  }
  const folderPath = folderMapping.get(folderKey)!;
  if (isUnsafeFilename(filename)) {
    return { error: 'Invalid filename', status: 400 };
  }
  const subpathError = validateSubpath(subpath);
  if (subpathError) {
    return { error: subpathError, status: 400 };
  }
  const { resolved: targetDir, error: resolveError } = resolveSubpath(folderPath, subpath);
  if (resolveError) {
    return { error: resolveError, status: 400 };
  }
  const fullPath = path.join(targetDir, filename);
  if (!path.resolve(fullPath).startsWith(path.resolve(folderPath) + path.sep)) {
    return { error: 'Path traversal detected', status: 400 };
  }
  return { fullPath };
}

/** Sanitizes a folder name for mkdir. Returns null if invalid. */
export function sanitizeFolderName(name: string): string | null {
  if (!name || name.length > 100) return null;
  if (name.startsWith('.')) return null;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (!/^[a-zA-Z0-9 _.-]+$/.test(name)) return null;
  return name;
}

/** Sanitizes a file name for rename. Returns null if invalid. */
export function sanitizeFileName(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (trimmed.startsWith('.')) return null;
  if (isUnsafeFilename(trimmed)) return null;
  // Reject control characters, null bytes, and Windows-reserved characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f<>:"*?|]/.test(trimmed)) return null;
  return trimmed;
}

export function isInternalIP(hostname: string): boolean {
  if (hostname === 'localhost') return true;

  // Strip brackets from IPv6 literals (e.g. [::1] → ::1)
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  // IPv6 loopback
  if (bare === '::1') return true;
  // IPv6 link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return true;
  // IPv6 unique-local fc00::/7  (fc:: and fd::)
  if (/^f[cd][0-9a-f]{2}:/i.test(bare)) return true;
  // IPv4-mapped IPv6 ::ffff:a.b.c.d or ::ffff:0xAB...
  if (/^::ffff:/i.test(bare)) return true;

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = bare.match(ipv4Regex);
  if (!match) return false;
  const parts = match.slice(1, 5).map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

async function downloadFile(
  url: string,
  destPath: string,
  signal: AbortSignal,
  onProgress?: (downloaded: number, total: number | undefined) => void,
): Promise<{ success: boolean; cancelled?: boolean; message?: string; totalBytes?: number }> {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal });
    if (!response.ok) {
      return { success: false, message: `HTTP error: ${response.status} ${response.statusText}` };
    }
    const contentLength = response.headers.get('content-length');
    const parsedLength = contentLength ? parseInt(contentLength, 10) : NaN;
    const total = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : undefined;

    if (response.body) {
      const fileStream = createWriteStream(destPath);
      let downloaded = 0;
      let lastReported = 0;
      const THROTTLE_BYTES = 512 * 1024;
      const reader = response.body.getReader();
      try {
        while (true) {
          if (signal.aborted) {
            await reader.cancel();
            fileStream.destroy();
            return { success: false, cancelled: true };
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          downloaded += chunk.length;
          const canContinue = fileStream.write(chunk);
          if (!canContinue) {
            await new Promise<void>((resolve) => fileStream.once('drain', resolve));
          }
          const threshold = total ? Math.max(total * 0.01, THROTTLE_BYTES) : THROTTLE_BYTES;
          if (downloaded - lastReported >= threshold) {
            lastReported = downloaded;
            onProgress?.(downloaded, total);
          }
        }
        onProgress?.(downloaded, total);
        await new Promise<void>((resolve, reject) =>
          fileStream.end((err: Error | null | undefined) => (err ? reject(err) : resolve())),
        );
        return { success: true, totalBytes: downloaded };
      } catch (err) {
        fileStream.destroy();
        throw err;
      }
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);
      await writeFile(destPath, data);
      return { success: true, totalBytes: data.length };
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { success: false, cancelled: true };
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Download failed',
    };
  }
}

function serializeJob(job: DownloadJob) {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    message: job.message,
    filename: job.filename,
    folder_key: job.folderKey,
    total_bytes: job.totalBytes,
    downloaded_bytes: job.downloadedBytes,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    type: job.type,
    peers: job.peers,
    download_speed: job.downloadSpeed,
    ytdlp_percent: job.ytdlpPercent,
    ytdlp_speed: job.ytdlpSpeed,
    ytdlp_eta: job.ytdlpEta,
    ytdlp_phase: job.ytdlpPhase,
    video_id: job.videoId,
  };
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function scheduleJobExpiry(jobs: Map<string, DownloadJob>, jobId: string): void {
  setTimeout(() => { jobs.delete(jobId); }, JOB_TTL_MS).unref();
}

// ─── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates and returns a fully configured Express application.
 * Each call produces an independent instance with its own in-memory job store
 * and session map — perfect for isolated integration tests.
 */
export function buildApp() {
  const app = express();

  // Trust the first proxy hop so express-rate-limit can read X-Forwarded-For
  // correctly when running behind nginx / Traefik / Caddy etc.
  app.set('trust proxy', 1);

  // Per-instance state (isolated between test suites)
  const jobs = new Map<string, DownloadJob>();


  // Parse once at startup — DOWNLOAD_FOLDERS is static for the lifetime of the process
  const folderMapping = parseFolderMapping(process.env.DOWNLOAD_FOLDERS || '');

  // Resolve log path from env at buildApp() call time so tests can override LOG_DIR
  const log = makeLogger();
  const usage = buildUsageTracker();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());

  // Track all /api requests for the usage page
  app.use('/api', usage.middleware);

  // ── Rate limiters ──────────────────────────────────────────────────────────
  // Each buildApp() call creates its own in-memory rate-limit store, so
  // parallel test instances using different app objects don't share counters.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
  });
  // Separate limiter for the password-as-Bearer path — higher limit to allow
  // API clients using the password directly rather than a session token.
  const passwordBearerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });

  // ── Auth helpers (scoped to this instance) ──────────────────────────────────
  function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!isAuthEnabled()) { next(); return; }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (isValidSession(token)) { next(); return; }
    // Password-as-Bearer fallback — goes through its own rate limiter so
    // brute-force via any protected endpoint is throttled identically to /api/auth.
    passwordBearerLimiter(req, res, () => {
      if (!verifyPassword(token)) { res.status(401).json({ error: 'Unauthorized' }); return; }
      next();
    });
  }

  // ── POST /api/auth ──────────────────────────────────────────────────────────
  app.post('/api/auth', authLimiter, (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ token: 'no-auth' });
      return;
    }
    const { password } = req.body as { password?: string };
    if (!verifyPassword(password ?? '')) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    const token = createSession();
    log('INFO', 'New session created');
    res.json({ token });
  });

  // ── GET /api/config ─────────────────────────────────────────────────────────
  app.get('/api/config', authMiddleware, async (_req, res) => {
    const allowedExtensionsEnv = process.env.ALLOWED_EXTENSIONS || '';
    const folders = Array.from(folderMapping.keys());
    const allowedExtensions = allowedExtensionsEnv
      .split(',')
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0);
    const transcoding = process.env.ENABLE_TRANSCODING === 'true';

    // Get free space for each folder
    const freeSpace: Record<string, number> = {};
    await Promise.all(
      Array.from(folderMapping.entries()).map(async ([key, folderPath]) => {
        try {
          const stats = await statfs(folderPath);
          freeSpace[key] = stats.bavail * stats.bsize;
        } catch {
          // Folder may not exist yet or be inaccessible
        }
      }),
    );

    log('INFO', 'Config requested', { folders, allowedExtensions, transcoding });
    res.json({ folders, allowedExtensions, transcoding, freeSpace });
  });

  // ── GET /api/usage ────────────────────────────────────────────────────────
  app.get('/api/usage', authMiddleware, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : undefined;
    try {
      const result = await usage.read({ from, to, path: endpoint, page, limit });
      res.json({ ...result, page, limit });
    } catch (err) {
      log('ERROR', 'Usage read failed', { error: String(err) });
      res.status(500).json({ error: 'Failed to read usage logs' });
    }
  });

  // ── POST /api/download ──────────────────────────────────────────────────────
  app.post('/api/download', authMiddleware, async (req, res) => {
    const { url, folderKey, filenameOverride } = req.body as {
      url?: string;
      folderKey?: string;
      filenameOverride?: string;
    };

    if (!url || !folderKey) {
      res.status(400).json({ error: 'Missing required fields: url and folderKey' });
      return;
    }

    const urlCheck = validateExternalUrl(url);
    if ('error' in urlCheck) {
      res.status(400).json({ error: urlCheck.error });
      return;
    }
    const parsedUrl = urlCheck.url;


    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }

    const destinationFolder = folderMapping.get(folderKey)!;

    let filename: string;
    if (filenameOverride) {
      filename = sanitizeFilename(filenameOverride);
    } else {
      const urlPath = parsedUrl.pathname;
      const lastSegment = urlPath.substring(urlPath.lastIndexOf('/') + 1);
      filename = sanitizeFilename(lastSegment || 'download');
    }
    if (!filename || filename === '') filename = 'download';

    const allowedExtensions = (process.env.ALLOWED_EXTENSIONS || '')
      .split(',')
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.length > 0);

    const extError = validateExtension(filename, allowedExtensions);
    if (extError) {
      res.status(400).json({ error: extError });
      return;
    }

    const fullPath = path.join(destinationFolder, filename);
    const resolvedDest = path.resolve(destinationFolder);
    const resolvedFull = path.resolve(fullPath);
    if (!resolvedFull.startsWith(resolvedDest + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }

    if (!existsSync(destinationFolder)) {
      mkdirSync(destinationFolder, { recursive: true });
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const abortController = new AbortController();

    const job: DownloadJob = {
      id: jobId,
      url,
      folderKey,
      filename,
      destPath: fullPath,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      abortController,
    };

    jobs.set(jobId, job);
    log('INFO', 'Download job created', { jobId, url, folderKey, filename });
    notifyDiscord(`⬇️ Download started: **${filename}** → \`${folderKey}\``);

    setImmediate(async () => {
      const j = jobs.get(jobId)!;
      j.status = 'downloading';
      j.downloadedBytes = 0;
      j.updatedAt = new Date().toISOString();
      log('INFO', 'Download started', { jobId, url, fullPath });

      const result = await downloadFile(url, fullPath, abortController.signal, (downloaded, total) => {
        const jj = jobs.get(jobId);
        if (jj) {
          jj.downloadedBytes = downloaded;
          if (total !== undefined) jj.totalBytes = total;
          jj.updatedAt = new Date().toISOString();
        }
      });

      j.updatedAt = new Date().toISOString();
      j.abortController = undefined;

      if (result.cancelled) {
        j.status = 'cancelled';
        j.message = 'Download cancelled';
        log('INFO', 'Download cancelled', { jobId });
        unlink(fullPath).catch(() => {});
      } else if (result.success) {
        j.status = 'done';
        j.downloadedBytes = result.totalBytes;
        j.totalBytes = result.totalBytes;
        j.message = `Downloaded to ${fullPath}`;
        log('INFO', 'Download completed', { jobId, fullPath });
        notifyDiscord(`✅ Download completed: **${j.filename}** → \`${j.folderKey}\`${result.totalBytes ? ` (${formatBytes(result.totalBytes)})` : ''}`);
      } else {
        j.status = 'error';
        j.message = result.message;
        log('ERROR', 'Download failed', { jobId, error: result.message });
        notifyDiscord(`❌ Download failed: **${j.filename}** → \`${j.folderKey}\``);
      }

      // .unref() prevents this timer from keeping the Node process alive in tests
      scheduleJobExpiry(jobs, jobId);
    });

    res.json({ id: jobId, status: 'queued' });
  });

  // ── POST /api/upload ────────────────────────────────────────────────────────
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: (() => {
        const raw = process.env.MAX_UPLOAD_SIZE || '10gb';
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
        if (!match) return 100 * 1024 * 1024;
        const n = parseFloat(match[1]);
        const unit = (match[2] || 'b').toLowerCase();
        const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
        return Math.floor(n * (multipliers[unit] ?? 1));
      })(),
    },
  });

  app.post('/api/upload', (req, _res, next) => {
    // Disable socket-level timeout for uploads so large files don't 408.
    req.socket.setTimeout(0);
    next();
  }, authMiddleware, upload.single('file'), async (req, res) => {
    const { folderKey, filenameOverride } = req.body as {
      folderKey?: string;
      filenameOverride?: string;
    };

    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    if (!folderKey) {
      res.status(400).json({ error: 'Missing required field: folderKey' });
      return;
    }


    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }

    const destinationFolder = folderMapping.get(folderKey)!;
    let filename = sanitizeFilename(filenameOverride || req.file.originalname || 'upload');
    if (!filename) filename = 'upload';

    const allowedExtensions = (process.env.ALLOWED_EXTENSIONS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const extError = validateExtension(filename, allowedExtensions);
    if (extError) {
      res.status(400).json({ error: extError });
      return;
    }

    const fullPath = path.join(destinationFolder, filename);
    const resolvedDest = path.resolve(destinationFolder);
    const resolvedFull = path.resolve(fullPath);
    if (!resolvedFull.startsWith(resolvedDest + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }

    if (!existsSync(destinationFolder)) {
      mkdirSync(destinationFolder, { recursive: true });
    }

    notifyDiscord(`⬆️ Upload started: **${filename}** → \`${folderKey}\``);

    try {
      await writeFile(fullPath, req.file.buffer);
    } catch (err) {
      log('ERROR', 'Upload write failed', { filename, error: String(err) });
      res.status(500).json({ error: 'Failed to save file' });
      return;
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const job: DownloadJob = {
      id: jobId,
      url: `[upload] ${filename}`,
      folderKey,
      filename,
      destPath: fullPath,
      status: 'done',
      message: `Uploaded to ${fullPath}`,
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(jobId, job);
    log('INFO', 'File uploaded', { jobId, filename, folderKey, fullPath });
    notifyDiscord(`✅ Upload completed: **${filename}** → \`${folderKey}\` (${formatBytes(req.file.size)})`);
    scheduleJobExpiry(jobs, jobId);

    res.json({
      id: jobId,
      status: 'done',
      filename,
      folder_key: folderKey,
      message: job.message,
    });
  });

  // ── POST /api/torrent ───────────────────────────────────────────────────────
  app.post('/api/torrent', authMiddleware, upload.single('torrent'), (req, res) => {
    const { folderKey, magnet } = req.body as { folderKey?: string; magnet?: string };
    const torrentBuffer = req.file?.buffer;

    if (!folderKey) {
      res.status(400).json({ error: 'Missing required field: folderKey' });
      return;
    }
    if (!magnet && !torrentBuffer) {
      res.status(400).json({ error: 'Provide a magnet link or .torrent file' });
      return;
    }
    if (magnet && !magnet.startsWith('magnet:') && !magnet.startsWith('http://') && !magnet.startsWith('https://')) {
      res.status(400).json({ error: 'Invalid torrent input: expected magnet link or http(s) URL to .torrent file' });
      return;
    }


    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }
    const destinationFolder = folderMapping.get(folderKey)!;

    if (!existsSync(destinationFolder)) {
      mkdirSync(destinationFolder, { recursive: true });
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const torrentInput = magnet || torrentBuffer!;

    const job: DownloadJob = {
      id: jobId,
      url: magnet || '[torrent file]',
      folderKey,
      filename: '',
      destPath: destinationFolder,
      status: 'queued',
      type: 'torrent',
      createdAt: now,
      updatedAt: now,
    };

    jobs.set(jobId, job);
    log('INFO', 'Torrent job created', { jobId, folderKey });
    notifyDiscord(`🧲 Torrent started → \`${folderKey}\``);

    setImmediate(async () => {
      const j = jobs.get(jobId);
      if (!j || j.status === 'cancelled') {
        // Job was cancelled before we got here — just ensure cleanup timer is set
        if (j) scheduleJobExpiry(jobs, jobId);
        return;
      }
      j.status = 'downloading';
      j.downloadedBytes = 0;
      j.updatedAt = new Date().toISOString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let client: any;
      try {
        client = await getWTClient();
      } catch (err) {
        j.status = 'error';
        j.message = err instanceof Error ? err.message : 'Failed to initialize torrent client';
        j.updatedAt = new Date().toISOString();
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const torrent = client.add(torrentInput, { path: destinationFolder }, (t: any) => {
        const jj = jobs.get(jobId);
        if (jj) {
          jj.filename = t.name;
          jj.totalBytes = t.length || undefined;
          jj.updatedAt = new Date().toISOString();
        }
      });

      j.torrentRef = torrent;

      const progressInterval = setInterval(() => {
        const jj = jobs.get(jobId);
        if (!jj || jj.status !== 'downloading') { clearInterval(progressInterval); return; }
        jj.downloadedBytes = torrent.downloaded;
        if (torrent.length) jj.totalBytes = torrent.length;
        if (torrent.name && !jj.filename) jj.filename = torrent.name;
        jj.peers = torrent.numPeers;
        jj.downloadSpeed = Math.round(torrent.downloadSpeed);
        jj.updatedAt = new Date().toISOString();
      }, 500);

      torrent.on('done', () => {
        clearInterval(progressInterval);
        const jj = jobs.get(jobId);
        if (!jj) return;
        jj.status = 'done';
        jj.downloadedBytes = torrent.length;
        jj.totalBytes = torrent.length;
        jj.filename = torrent.name;
        jj.peers = undefined;
        jj.downloadSpeed = undefined;
        jj.message = `Downloaded to ${destinationFolder}`;
        jj.torrentRef = undefined;
        jj.updatedAt = new Date().toISOString();
        log('INFO', 'Torrent completed', { jobId, name: torrent.name, bytes: torrent.length });
        notifyDiscord(`✅ Torrent completed: **${torrent.name}** → \`${folderKey}\`${torrent.length ? ` (${formatBytes(torrent.length)})` : ''}`);
        torrent.destroy();
        scheduleJobExpiry(jobs, jobId);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      torrent.on('error', (err: any) => {
        clearInterval(progressInterval);
        const jj = jobs.get(jobId);
        if (!jj) return;
        jj.status = 'error';
        jj.message = err instanceof Error ? err.message : String(err);
        jj.torrentRef = undefined;
        jj.updatedAt = new Date().toISOString();
        log('ERROR', 'Torrent error', { jobId, error: jj.message });
        notifyDiscord(`❌ Torrent failed: **${jj.filename || 'unknown'}** → \`${folderKey}\``);
        scheduleJobExpiry(jobs, jobId);
      });
    });

    res.json({ id: jobId, status: 'queued', type: 'torrent' });
  });

  // ── GET /api/jobs ───────────────────────────────────────────────────────────
  app.get('/api/jobs', authMiddleware, (_req, res) => {
    const allJobs = Array.from(jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(allJobs.map(serializeJob));
  });

  // ── DELETE /api/jobs/:jobId ─────────────────────────────────────────────────
  app.delete('/api/jobs/:jobId', authMiddleware, async (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (job.status !== 'queued' && job.status !== 'downloading') {
      res.status(400).json({ error: `Cannot cancel a job with status "${job.status}"` });
      return;
    }
    job.status = 'cancelled';
    job.message = 'Download cancelled';
    job.updatedAt = new Date().toISOString();
    if (job.abortController) job.abortController.abort();
    // yt-dlp: no scheduleJobExpiry here — the async runYtdlp callback handles it
    if (job.type === 'torrent' && job.torrentRef) {
      job.torrentRef.destroy();
      job.torrentRef = undefined;
      scheduleJobExpiry(jobs, jobId);
    }
    log('INFO', 'Job cancelled', { jobId });
    res.json({ id: jobId, status: 'cancelled' });
  });

  // ── GET /api/status/:jobId ──────────────────────────────────────────────────
  app.get('/api/status/:jobId', authMiddleware, (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(serializeJob(job));
  });

  // ── MIME type map ──────────────────────────────────────────────────────────
  const MIME_MAP: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/plain',
    '.csv': 'text/plain',
    '.log': 'text/plain',
    '.json': 'application/json',
    '.xml': 'text/xml',
    '.yaml': 'text/plain',
    '.yml': 'text/plain',
    '.ini': 'text/plain',
    '.conf': 'text/plain',
    '.cfg': 'text/plain',
    '.sh': 'text/plain',
    '.py': 'text/plain',
    '.js': 'text/plain',
    '.ts': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.toml': 'text/plain',
    '.nfo': 'text/plain',
    '.srt': 'text/plain',
    '.sub': 'text/plain',
    '.ass': 'text/plain',
  };

  // ── Auth middleware that also accepts ?token= query param ──────────────────
  function authMiddlewareWithQuery(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!isAuthEnabled()) { next(); return; }
    // Try Authorization header first
    const authHeader = req.headers['authorization'] || '';
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (isValidSession(headerToken)) { next(); return; }
    // Fall back to query param (for <video>/<audio>/<img> tags)
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    if (isValidSession(queryToken)) { next(); return; }
    res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET /api/browse/:folderKey ────────────────────────────────────────────
  app.get('/api/browse/:folderKey', authMiddleware, async (req, res) => {
    const { folderKey } = req.params;

    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }

    const folderPath = folderMapping.get(folderKey)!;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';
    const subpathError = validateSubpath(subpath);
    if (subpathError) {
      res.status(400).json({ error: subpathError });
      return;
    }

    const { resolved: targetDir, error: resolveError } = resolveSubpath(folderPath, subpath);
    if (resolveError) {
      res.status(400).json({ error: resolveError });
      return;
    }

    if (!existsSync(targetDir)) {
      res.json({ files: [], dirs: [], total: 0, subpath, maxDepth: 2 });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    try {
      const entries = await readdir(targetDir, { withFileTypes: true });
      const fileEntries = entries.filter(e => e.isFile());

      // Gather stats for all files
      const fileInfos = await Promise.all(
        fileEntries.map(async (entry) => {
          const filePath = path.join(targetDir, entry.name);
          const fileStat = await stat(filePath);
          return {
            name: entry.name,
            size: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
          };
        })
      );

      const sortField = typeof req.query.sort === 'string' && ['name', 'size', 'modified'].includes(req.query.sort) ? req.query.sort : 'modified';
      const sortOrder = typeof req.query.order === 'string' && req.query.order === 'asc' ? 'asc' : 'desc';

      fileInfos.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'name') cmp = a.name.localeCompare(b.name);
        else if (sortField === 'size') cmp = a.size - b.size;
        else cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
        return sortOrder === 'asc' ? cmp : -cmp;
      });

      const total = fileInfos.length;
      const offset = (page - 1) * limit;
      const paged = fileInfos.slice(offset, offset + limit);

      // Include directories if current depth < 2
      const currentDepth = subpath === '' ? 0 : subpath.split('/').length;
      let dirs: { name: string }[] = [];
      if (currentDepth < 2) {
        dirs = entries
          .filter(e => e.isDirectory())
          .map(e => ({ name: e.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      res.json({ files: paged, dirs, total, page, limit, subpath, maxDepth: 2 });
    } catch (err) {
      log('ERROR', 'Browse listing failed', { folderKey, error: String(err) });
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // ── Shared validation for dir endpoints (mkdir, rename-dir, rmdir) ────────
  function validateDirRequest(
    folderKey: string,
    rawSubpath: unknown,
    res: import('express').Response,
  ): { subpath: string; folderPath: string } | null {
    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return null;
    }

    const subpath = typeof rawSubpath === 'string' ? rawSubpath : '';
    const subpathError = validateSubpath(subpath);
    if (subpathError) {
      res.status(400).json({ error: subpathError });
      return null;
    }

    return { subpath, folderPath: folderMapping.get(folderKey)! };
  }

  // ── POST /api/browse/:folderKey/mkdir ──────────────────────────────────────
  app.post('/api/browse/:folderKey/mkdir', authMiddleware, async (req, res) => {
    const { folderKey } = req.params;
    const { name, subpath: rawSubpath } = req.body;

    const validated = validateDirRequest(folderKey, rawSubpath, res);
    if (!validated) return;
    const { subpath, folderPath } = validated;

    const sanitized = sanitizeFolderName(name);
    if (!sanitized) {
      res.status(400).json({ error: 'Invalid folder name' });
      return;
    }

    // Check if creating would exceed depth 2
    const currentDepth = subpath === '' ? 0 : subpath.split('/').length;
    if (currentDepth >= 2) {
      res.status(400).json({ error: 'Max depth of 2 exceeded' });
      return;
    }

    const newSubpath = subpath === '' ? sanitized : `${subpath}/${sanitized}`;
    const { resolved: targetDir, error: resolveError } = resolveSubpath(folderPath, newSubpath);
    if (resolveError) {
      res.status(400).json({ error: resolveError });
      return;
    }

    try {
      await mkdir(targetDir, { recursive: false });
      res.json({ ok: true, name: sanitized });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        res.status(409).json({ error: 'Folder already exists' });
        return;
      }
      log('ERROR', 'mkdir failed', { folderKey, name: sanitized, error: String(err) });
      res.status(500).json({ error: 'Failed to create folder' });
    }
  });

  // ── POST /api/browse/:folderKey/rename-dir ────────────────────────────────
  app.post('/api/browse/:folderKey/rename-dir', authMiddleware, async (req, res) => {
    const { folderKey } = req.params;
    const { subpath: rawSubpath, oldName, newName } = req.body;

    const validated = validateDirRequest(folderKey, rawSubpath, res);
    if (!validated) return;
    const { subpath, folderPath } = validated;

    if (!oldName || typeof oldName !== 'string' || isUnsafeFilename(oldName)) {
      res.status(400).json({ error: 'Invalid old folder name' });
      return;
    }

    const sanitized = sanitizeFolderName(newName);
    if (!sanitized) {
      res.status(400).json({ error: 'Invalid new folder name' });
      return;
    }

    const oldSubpath = subpath === '' ? oldName : `${subpath}/${oldName}`;
    const newSubpath = subpath === '' ? sanitized : `${subpath}/${sanitized}`;
    const { resolved: oldDir, error: oldErr } = resolveSubpath(folderPath, oldSubpath);
    if (oldErr) { res.status(400).json({ error: oldErr }); return; }
    const { resolved: newDir, error: newErr } = resolveSubpath(folderPath, newSubpath);
    if (newErr) { res.status(400).json({ error: newErr }); return; }

    try {
      const s = await stat(oldDir);
      if (!s.isDirectory()) {
        res.status(400).json({ error: 'Not a directory' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    try {
      await stat(newDir);
      res.status(409).json({ error: 'A folder with that name already exists' });
      return;
    } catch {
      // newDir does not exist — proceed
    }

    try {
      await rename(oldDir, newDir);
      res.json({ ok: true, name: sanitized });
    } catch (err) {
      log('ERROR', 'rename-dir failed', { folderKey, oldName, newName: sanitized, error: String(err) });
      res.status(500).json({ error: 'Failed to rename folder' });
    }
  });

  // ── POST /api/browse/:folderKey/rename-file ──────────────────────────────
  app.post('/api/browse/:folderKey/rename-file', authMiddleware, async (req, res) => {
    const { folderKey } = req.params;
    const { subpath: rawSubpath, oldName, newName } = req.body;

    const validated = validateDirRequest(folderKey, rawSubpath, res);
    if (!validated) return;
    const { subpath, folderPath } = validated;

    if (!oldName || typeof oldName !== 'string' || isUnsafeFilename(oldName)) {
      res.status(400).json({ error: 'Invalid old file name' });
      return;
    }

    const sanitized = sanitizeFileName(newName);
    if (!sanitized) {
      res.status(400).json({ error: 'Invalid new file name' });
      return;
    }

    const { resolved: dir, error: dirErr } = resolveSubpath(folderPath, subpath);
    if (dirErr) { res.status(400).json({ error: dirErr }); return; }

    const oldFile = path.join(dir, oldName);
    const newFile = path.join(dir, sanitized);

    if (!path.resolve(oldFile).startsWith(path.resolve(folderPath) + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }
    if (!path.resolve(newFile).startsWith(path.resolve(folderPath) + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }

    try {
      const s = await stat(oldFile);
      if (!s.isFile()) {
        res.status(400).json({ error: 'Not a file' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    try {
      await stat(newFile);
      res.status(409).json({ error: 'A file with that name already exists' });
      return;
    } catch {
      // newFile does not exist — proceed
    }

    try {
      await rename(oldFile, newFile);
      res.json({ ok: true, name: sanitized });
    } catch (err) {
      log('ERROR', 'rename-file failed', { folderKey, oldName, newName: sanitized, error: String(err) });
      res.status(500).json({ error: 'Failed to rename file' });
    }
  });

  // ── DELETE /api/browse/:folderKey/rmdir ──────────────────────────────────
  app.delete('/api/browse/:folderKey/rmdir', authMiddleware, async (req, res) => {
    const { folderKey } = req.params;
    const { subpath: rawSubpath, name } = req.body as { subpath?: string; name?: string };

    const validated = validateDirRequest(folderKey, rawSubpath, res);
    if (!validated) return;
    const { subpath, folderPath } = validated;

    if (!name || typeof name !== 'string' || isUnsafeFilename(name)) {
      res.status(400).json({ error: 'Invalid folder name' });
      return;
    }

    const dirSubpath = subpath === '' ? name : `${subpath}/${name}`;
    const { resolved: dirPath, error: resolveError } = resolveSubpath(folderPath, dirSubpath);
    if (resolveError) {
      res.status(400).json({ error: resolveError });
      return;
    }

    try {
      const s = await stat(dirPath);
      if (!s.isDirectory()) {
        res.status(400).json({ error: 'Not a directory' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    try {
      await rm(dirPath, { recursive: true });
      res.json({ ok: true });
    } catch (err) {
      log('ERROR', 'rmdir failed', { folderKey, name, error: String(err) });
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // ── Auto-clean ─────────────────────────────────────────────────────────────
  startCacheCleanup(log);
  const initialAutoCleanRules = loadRulesSync();
  const autoClean: AutoCleanHandle = startAutoClean(folderMapping, log, initialAutoCleanRules);

  // ── GET /api/auto-clean ─────────────────────────────────────────────────
  app.get('/api/auto-clean', authMiddleware, (_req, res) => {
    const folders = Array.from(folderMapping.keys());
    res.json({ rules: autoClean.getRules(), folders });
  });

  // ── PUT /api/auto-clean ─────────────────────────────────────────────────
  app.put('/api/auto-clean', authMiddleware, async (req, res) => {
    const { rules } = req.body as { rules?: Record<string, number> };
    if (!rules || typeof rules !== 'object') {
      res.status(400).json({ error: 'Missing or invalid rules object' });
      return;
    }
    // Validate folder keys and values
    const cleaned: Record<string, number> = {};
    for (const [key, value] of Object.entries(rules)) {
      if (!folderMapping.has(key)) {
        res.status(400).json({ error: `Unknown folder key: ${key}` });
        return;
      }
      const days = typeof value === 'number' ? Math.max(0, Math.floor(value)) : 0;
      if (days > 0) cleaned[key] = days;
    }
    try {
      await saveRules(cleaned);
      autoClean.updateRules(cleaned);
      log('INFO', 'Auto-clean rules updated', { rules: cleaned });
      res.json({ ok: true, rules: cleaned });
    } catch (err) {
      log('ERROR', 'Failed to save auto-clean rules', { error: String(err) });
      res.status(500).json({ error: 'Failed to save rules' });
    }
  });

  // ── POST /api/ytdlp ────────────────────────────────────────────────────────
  app.post('/api/ytdlp', authMiddleware, async (req, res) => {
    const { url, folderKey, format } = req.body as {
      url?: string;
      folderKey?: string;
      format?: 'video' | 'audio';
    };

    if (!url || !folderKey) {
      res.status(400).json({ error: 'Missing required fields: url and folderKey' });
      return;
    }

    const ytdlpUrlCheck = validateExternalUrl(url);
    if ('error' in ytdlpUrlCheck) {
      res.status(400).json({ error: ytdlpUrlCheck.error });
      return;
    }

    if (format !== 'video' && format !== 'audio') {
      res.status(400).json({ error: 'format must be "video" or "audio"' });
      return;
    }
    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }

    const destinationFolder = folderMapping.get(folderKey)!;
    const jobId = launchYtdlpJob({ url, folderKey, destinationFolder, format });
    res.json({ id: jobId, status: 'queued', type: 'ytdlp' });
  });

  // ── Shared yt-dlp job launcher ────────────────────────────────────────────
  function launchYtdlpJob(opts: {
    url: string;
    folderKey: string;
    destinationFolder: string;
    format: 'video' | 'audio';
    videoId?: string;
    playlistId?: string;
  }): string {
    const { url, folderKey, destinationFolder, format, videoId, playlistId } = opts;

    if (!existsSync(destinationFolder)) {
      mkdirSync(destinationFolder, { recursive: true });
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const abortController = new AbortController();

    const job: DownloadJob = {
      id: jobId,
      url,
      folderKey,
      filename: '',
      destPath: destinationFolder,
      status: 'queued',
      type: 'ytdlp',
      videoId,
      playlistId,
      createdAt: now,
      updatedAt: now,
      abortController,
    };

    jobs.set(jobId, job);
    log('INFO', 'yt-dlp job created', { jobId, url, folderKey, format, videoId });
    notifyDiscord(`🎬 yt-dlp ${format} download started → \`${folderKey}\``);

    setImmediate(() => {
      (async () => {
        const j = jobs.get(jobId);
        if (!j || j.status === 'cancelled') {
          if (j) scheduleJobExpiry(jobs, jobId);
          return;
        }

        // Resolve video title before starting download
        const title = await fetchVideoTitle(url);
        if (abortController.signal.aborted) {
          j.status = 'cancelled';
          j.message = 'Download cancelled';
          if (videoId && playlistId) playlistSync.handleJobComplete(playlistId, videoId, { success: false, cancelled: true });
          scheduleJobExpiry(jobs, jobId);
          return;
        }
        if (title) {
          j.filename = title;
          j.updatedAt = new Date().toISOString();
        }

        j.status = 'downloading';
        j.ytdlpPhase = 'downloading';
        j.updatedAt = new Date().toISOString();

        const result = await runYtdlp(url, destinationFolder, format, abortController.signal, (progress) => {
          const jj = jobs.get(jobId);
          if (!jj) return;
          jj.ytdlpPercent = progress.percent;
          jj.ytdlpSpeed = progress.speed;
          jj.ytdlpEta = progress.eta;
          jj.ytdlpPhase = progress.phase;
          jj.updatedAt = new Date().toISOString();
        });

        j.updatedAt = new Date().toISOString();
        j.abortController = undefined;

        if (result.cancelled) {
          j.status = 'cancelled';
          j.message = 'Download cancelled';
          log('INFO', 'yt-dlp download cancelled', { jobId });
          // Clean up partial files left by yt-dlp, scoped to this job's filename only
          if (result.filename) {
            const toDelete = [
              result.filename,
              result.filename + '.part',
              result.filename + '.ytdl',
            ];
            const deleted: string[] = [];
            for (const f of toDelete) {
              const fp = path.join(destinationFolder, f);
              try {
                await unlink(fp);
                deleted.push(f);
              } catch {
                // file doesn't exist or already removed — ignore
              }
            }
            if (deleted.length > 0) {
              log('INFO', 'yt-dlp cancelled: cleaned up partial files', { jobId, files: deleted });
            }
          }
          if (videoId && playlistId) playlistSync.handleJobComplete(playlistId, videoId, { success: false, cancelled: true, title: j.filename || undefined });
        } else if (result.success) {
          j.status = 'done';
          j.filename = result.filename || j.filename || 'unknown';
          j.message = `Downloaded to ${destinationFolder}`;
          log('INFO', 'yt-dlp download completed', { jobId, filename: j.filename });
          notifyDiscord(`✅ yt-dlp completed: **${j.filename}** → \`${folderKey}\``);
          if (videoId && playlistId) playlistSync.handleJobComplete(playlistId, videoId, { success: true, title: j.filename || undefined });
        } else {
          j.status = 'error';
          j.message = result.message;
          log('ERROR', 'yt-dlp download failed', { jobId, error: result.message });
          if (videoId && playlistId) playlistSync.handleJobComplete(playlistId, videoId, { success: false, error: result.message, title: j.filename || undefined });
        }

        scheduleJobExpiry(jobs, jobId);
      })().catch((err) => {
        log('ERROR', 'yt-dlp job unexpected error', { jobId, error: String(err) });
        const j = jobs.get(jobId);
        if (j) {
          j.status = 'error';
          j.message = `Unexpected error: ${err}`;
          j.abortController = undefined;
          scheduleJobExpiry(jobs, jobId);
        }
        if (videoId && playlistId) playlistSync.handleJobComplete(playlistId, videoId, { success: false, error: String(err) });
      });
    });

    return jobId;
  }

  // ── Playlist sync ─────────────────────────────────────────────────────────
  const initialPlaylists = loadPlaylistsSync();
  const playlistSync: PlaylistSyncHandle = startPlaylistSync(
    folderMapping,
    log,
    initialPlaylists,
    (videoId, playlistId, _playlistUrl, folderKey, format) => {
      const destinationFolder = folderMapping.get(folderKey);
      if (!destinationFolder) return '';
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      return launchYtdlpJob({ url: videoUrl, folderKey, destinationFolder, format, videoId, playlistId });
    },
  );

  // ── GET /api/playlists ──────────────────────────────────────────────────────
  app.get('/api/playlists', authMiddleware, (_req, res) => {
    const folders = Array.from(folderMapping.keys());
    res.json({ playlists: playlistSync.getPlaylists(), folders });
  });

  // ── PUT /api/playlists ──────────────────────────────────────────────────────
  app.put('/api/playlists', authMiddleware, async (req, res) => {
    const { playlists } = req.body as { playlists?: Playlist[] };
    if (!Array.isArray(playlists)) {
      res.status(400).json({ error: 'Missing or invalid playlists array' });
      return;
    }
    // Validate each playlist
    for (const pl of playlists) {
      if (!pl.url || !pl.folderKey || !pl.format) {
        res.status(400).json({ error: 'Each playlist must have url, folderKey, and format' });
        return;
      }
      const plUrlCheck = validateExternalUrl(pl.url);
      if ('error' in plUrlCheck) {
        res.status(400).json({ error: plUrlCheck.error });
        return;
      }
      if (!folderMapping.has(pl.folderKey)) {
        res.status(400).json({ error: `Unknown folder key: ${pl.folderKey}` });
        return;
      }
      if (pl.format !== 'video' && pl.format !== 'audio') {
        res.status(400).json({ error: 'format must be "video" or "audio"' });
        return;
      }
      if (typeof pl.syncIntervalHours !== 'number' || pl.syncIntervalHours < 1) {
        res.status(400).json({ error: 'syncIntervalHours must be a number >= 1' });
        return;
      }
    }
    try {
      // Merge server-side videoStatuses so a stale client doesn't erase sync progress
      const current = playlistSync.getPlaylists();
      const serverStatuses = new Map(current.map((p) => [p.id, p.videoStatuses]));
      for (const pl of playlists) {
        const existing = serverStatuses.get(pl.id);
        if (existing) {
          // Server-side statuses win for any video the server knows about
          pl.videoStatuses = { ...pl.videoStatuses, ...existing };
        }
        if (!pl.videoStatuses) pl.videoStatuses = {};
      }

      // Preserve titles already resolved server-side
      const currentTitles = new Map(current.map((p) => [p.id, p.title]));
      for (const pl of playlists) {
        if (!pl.title && currentTitles.get(pl.id)) {
          pl.title = currentTitles.get(pl.id);
        }
      }

      await savePlaylists(playlists);
      playlistSync.updatePlaylists(playlists);
      log('INFO', 'Playlists updated', { count: playlists.length });
      res.json({ ok: true, playlists });

      // Resolve titles in the background for playlists that don't have one yet
      const untitled = playlists.filter((pl) => !pl.title);
      if (untitled.length > 0) {
        (async () => {
          for (const pl of untitled) {
            const title = await fetchPlaylistTitle(pl.url);
            if (title) {
              pl.title = title;
              log('INFO', 'Resolved playlist title', { playlistId: pl.id, title });
            }
          }
          await savePlaylists(playlistSync.getPlaylists());
        })().catch((err) => log('ERROR', 'Failed to resolve playlist titles', { error: String(err) }));
      }
    } catch (err) {
      log('ERROR', 'Failed to save playlists', { error: String(err) });
      res.status(500).json({ error: 'Failed to save playlists' });
    }
  });

  // ── POST /api/playlists/sync ────────────────────────────────────────────────
  app.post('/api/playlists/sync', authMiddleware, async (req, res) => {
    const { playlistId } = req.body as { playlistId?: string };
    try {
      if (playlistId) {
        await playlistSync.syncPlaylist(playlistId);
      } else {
        await playlistSync.syncAll();
      }
      res.json({ ok: true, playlists: playlistSync.getPlaylists() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── GET /api/playlists/:playlistId/videos ──────────────────────────────────
  app.get('/api/playlists/:playlistId/videos', authMiddleware, (req, res) => {
    const pl = playlistSync.getPlaylists().find((p) => p.id === req.params.playlistId);
    if (!pl) { res.status(404).json({ error: 'Playlist not found' }); return; }

    const videos = Object.entries(pl.videoStatuses).map(([videoId, vs]) => {
      let liveProgress: { percent?: number; speed?: string; eta?: string; phase?: string } | undefined;
      if (vs.jobId && vs.status === 'downloading') {
        const job = jobs.get(vs.jobId);
        if (job) {
          liveProgress = {
            percent: job.ytdlpPercent,
            speed: job.ytdlpSpeed,
            eta: job.ytdlpEta,
            phase: job.ytdlpPhase,
          };
        }
      }
      return { videoId, ...vs, liveProgress };
    });

    res.json({ playlistId: pl.id, videos });
  });

  // ── POST /api/playlists/:playlistId/retry ─────────────────────────────────
  app.post('/api/playlists/:playlistId/retry', authMiddleware, async (req, res) => {
    const pl = playlistSync.getPlaylists().find((p) => p.id === req.params.playlistId);
    if (!pl) { res.status(404).json({ error: 'Playlist not found' }); return; }

    const { videoIds } = req.body as { videoIds?: string[] };
    const toRetry = videoIds || Object.entries(pl.videoStatuses)
      .filter(([, v]) => v.status === 'failed' || v.status === 'cancelled')
      .map(([id]) => id);

    const destinationFolder = folderMapping.get(pl.folderKey);
    if (!destinationFolder) { res.status(400).json({ error: 'Unknown folder' }); return; }

    let retried = 0;
    for (const vid of toRetry) {
      const vs = pl.videoStatuses[vid];
      if (!vs || (vs.status !== 'failed' && vs.status !== 'cancelled')) continue;
      const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
      const jobId = launchYtdlpJob({ url: videoUrl, folderKey: pl.folderKey, destinationFolder, format: pl.format, videoId: vid, playlistId: pl.id });
      vs.status = 'downloading';
      vs.jobId = jobId;
      vs.lastAttemptAt = new Date().toISOString();
      vs.error = undefined;
      retried++;
    }

    await savePlaylists(playlistSync.getPlaylists());
    res.json({ ok: true, retried, playlists: playlistSync.getPlaylists() });
  });

  // ── GET /api/browse/:folderKey/:filename/stream ───────────────────────────

  app.get('/api/browse/:folderKey/:filename/stream', authMiddlewareWithQuery, async (req, res) => {
    if (process.env.ENABLE_TRANSCODING !== 'true') {
      res.status(404).json({ error: 'Transcoding is not enabled' });
      return;
    }

    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';
    const streamResult = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in streamResult) {
      res.status(streamResult.status).json({ error: streamResult.error });
      return;
    }
    const { fullPath: streamFullPath } = streamResult;

    if (!existsSync(streamFullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    try {
      await handleStreamRequest(streamFullPath, filename, req, res, log);
    } catch (err) {
      log('ERROR', 'Stream failed', { filename, error: String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'Transcoding failed' });
    }
  });

  // ── GET /api/browse/:folderKey/:filename/transcode ───────────────────────
  // Non-blocking status endpoint used by the legacy player to avoid long-lived
  // HTTP connections that iOS Safari times out before any data arrives.
  // Starts transcoding in the background on first call; subsequent calls return
  // the current status ('ready' | 'transcoding' | 'error').
  app.get('/api/browse/:folderKey/:filename/transcode', authMiddlewareWithQuery, async (req, res) => {
    if (process.env.ENABLE_TRANSCODING !== 'true') {
      res.status(404).json({ error: 'Transcoding is not enabled' });
      return;
    }

    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';
    const result = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    if (!existsSync(result.fullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const status = await getTranscodeStatus(result.fullPath, filename, log);
    res.json(status);
  });

  // ── GET /api/browse/:folderKey/:filename ──────────────────────────────────
  app.get('/api/browse/:folderKey/:filename', authMiddlewareWithQuery, (req, res) => {
    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';
    const getResult = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in getResult) {
      res.status(getResult.status).json({ error: getResult.error });
      return;
    }
    const { fullPath } = getResult;

    if (!existsSync(fullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    serveFileWithRanges(fullPath, req, res, contentType);
  });

  // ── DELETE /api/browse/:folderKey/:filename ───────────────────────────────
  app.delete('/api/browse/:folderKey/:filename', authMiddleware, async (req, res) => {
    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';
    const deleteResult = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in deleteResult) {
      res.status(deleteResult.status).json({ error: deleteResult.error });
      return;
    }
    const { fullPath } = deleteResult;

    if (!existsSync(fullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    try {
      await unlink(fullPath);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // ── POST /api/browse/:folderKey/:filename/move-to-subpath ─────────────────
  app.post('/api/browse/:folderKey/:filename/move-to-subpath', authMiddleware, async (req, res) => {
    const { folderKey, filename } = req.params;
    const { sourceSubpath: rawSource, targetSubpath: rawTarget } = req.body;

    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid folder key: ${folderKey}` });
      return;
    }

    if (isUnsafeFilename(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const sourceSubpath = typeof rawSource === 'string' ? rawSource : '';
    const targetSubpath = typeof rawTarget === 'string' ? rawTarget : '';

    const srcError = validateSubpath(sourceSubpath);
    if (srcError) {
      res.status(400).json({ error: srcError });
      return;
    }
    const tgtError = validateSubpath(targetSubpath);
    if (tgtError) {
      res.status(400).json({ error: tgtError });
      return;
    }

    const folderPath = folderMapping.get(folderKey)!;
    const { resolved: srcDir, error: srcResolveError } = resolveSubpath(folderPath, sourceSubpath);
    if (srcResolveError) {
      res.status(400).json({ error: srcResolveError });
      return;
    }
    const { resolved: dstDir, error: dstResolveError } = resolveSubpath(folderPath, targetSubpath);
    if (dstResolveError) {
      res.status(400).json({ error: dstResolveError });
      return;
    }

    const srcPath = path.join(srcDir, filename);
    const dstPath = path.join(dstDir, filename);

    if (path.resolve(srcPath) === path.resolve(dstPath)) {
      res.status(400).json({ error: 'Source and target are the same file' });
      return;
    }

    if (!existsSync(srcPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (existsSync(dstPath)) {
      res.status(409).json({ error: 'A file with that name already exists in the target folder' });
      return;
    }

    try {
      try {
        await rename(srcPath, dstPath);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          res.status(409).json({ error: 'A file with that name already exists in the target folder' });
          return;
        }
        if (code === 'EXDEV') {
          await copyFile(srcPath, dstPath, fsConstants.COPYFILE_EXCL);
          await unlink(srcPath);
        } else {
          throw err;
        }
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        res.status(409).json({ error: 'A file with that name already exists in the target folder' });
        return;
      }
      log('ERROR', 'Move to subpath failed', { folderKey, filename, sourceSubpath, targetSubpath, error: String(err) });
      res.status(500).json({ error: 'Failed to move file' });
    }
  });

  // ── POST /api/browse/:folderKey/:filename/move ─────────────────────────────
  app.post('/api/browse/:folderKey/:filename/move', authMiddleware, async (req, res) => {
    const { folderKey, filename } = req.params;
    const { targetFolder, sourceSubpath: rawSourceSubpath } = req.body;
    if (!targetFolder || typeof targetFolder !== 'string') {
      res.status(400).json({ error: 'Missing targetFolder in body' });
      return;
    }
    if (targetFolder === folderKey) {
      res.status(400).json({ error: 'Target folder is the same as source' });
      return;
    }


    if (!folderMapping.has(folderKey)) {
      res.status(400).json({ error: `Invalid source folder key: ${folderKey}` });
      return;
    }
    if (!folderMapping.has(targetFolder)) {
      res.status(400).json({ error: `Invalid target folder key: ${targetFolder}` });
      return;
    }

    if (isUnsafeFilename(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const sourceSubpath = typeof rawSourceSubpath === 'string' ? rawSourceSubpath : '';
    const subpathError = validateSubpath(sourceSubpath);
    if (subpathError) {
      res.status(400).json({ error: subpathError });
      return;
    }

    const srcFolder = folderMapping.get(folderKey)!;
    const dstFolder = folderMapping.get(targetFolder)!;

    const { resolved: srcDir, error: srcResolveError } = resolveSubpath(srcFolder, sourceSubpath);
    if (srcResolveError) {
      res.status(400).json({ error: srcResolveError });
      return;
    }

    const srcPath = path.join(srcDir, filename);
    const dstPath = path.join(dstFolder, filename);

    // Path traversal checks
    if (!path.resolve(srcPath).startsWith(path.resolve(srcFolder) + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }
    if (!path.resolve(dstPath).startsWith(path.resolve(dstFolder) + path.sep)) {
      res.status(400).json({ error: 'Path traversal detected' });
      return;
    }

    if (!existsSync(srcPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (existsSync(dstPath)) {
      res.status(409).json({ error: 'A file with that name already exists in the target folder' });
      return;
    }
    try {
      try {
        await rename(srcPath, dstPath);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          res.status(409).json({ error: 'A file with that name already exists in the target folder' });
          return;
        }
        if (code === 'EXDEV') {
          await copyFile(srcPath, dstPath, fsConstants.COPYFILE_EXCL);
          await unlink(srcPath);
        } else {
          throw err;
        }
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        res.status(409).json({ error: 'A file with that name already exists in the target folder' });
        return;
      }
      log('ERROR', 'Move file failed', { folderKey, targetFolder, filename, error: String(err) });
      res.status(500).json({ error: 'Failed to move file' });
    }
  });

  // ── GET /api/json/:folderKey/:filename ────────────────────────────────────
  app.get('/api/json/:folderKey/:filename', authMiddleware, async (req, res) => {
    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';

    if (!filename.endsWith('.json')) {
      res.status(400).json({ error: 'Only .json files are supported' });
      return;
    }

    const resolved = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    try {
      const raw = await readFile(resolved.fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      if (err instanceof SyntaxError) {
        res.status(422).json({ error: 'File is not valid JSON' });
        return;
      }
      log('ERROR', 'JSON store read failed', { folderKey, filename, error: String(err) });
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  // ── PUT /api/json/:folderKey/:filename ────────────────────────────────────
  app.put('/api/json/:folderKey/:filename', authMiddleware, express.json({ limit: '1mb' }), async (req, res) => {
    const { folderKey, filename } = req.params;
    const subpath = typeof req.query.subpath === 'string' ? req.query.subpath : '';

    if (!filename.endsWith('.json')) {
      res.status(400).json({ error: 'Only .json files are supported' });
      return;
    }

    const resolved = resolveFilePath(folderKey, filename, subpath, folderMapping);
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    try {
      await stat(resolved.fullPath);
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const body = req.body;
    if (body === undefined || body === null) {
      res.status(400).json({ error: 'Request body is required' });
      return;
    }

    const tmpPath = resolved.fullPath + '.tmp';
    try {
      await writeFile(tmpPath, JSON.stringify(body, null, 2), 'utf-8');
      await rename(tmpPath, resolved.fullPath);
      res.json({ ok: true });
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      log('ERROR', 'JSON store write failed', { folderKey, filename, error: String(err) });
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  // ── Legacy HTML page ─────────────────────────────────────────────────────
  app.get('/legacy', (_req, res) => {
    res.sendFile(path.join(__dirname, 'legacy.html'));
  });

  // ── Multer / URI / general error handler ─────────────────────────────────
  // Placed after all routes so Express routes errors here correctly.
  // Catches URIError (malformed %xx from bots/scanners), MulterError, and fallbacks.
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof URIError) {
      res.status(400).json({ error: 'Malformed URL encoding' });
      return;
    }
    if (err instanceof multer.MulterError) {
      const messages: Record<string, string> = {
        LIMIT_FILE_SIZE: 'File is too large',
        LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
      };
      res.status(400).json({ error: messages[err.code] || err.message });
      return;
    }
    if (err) {
      res.status(500).json({ error: err.message || 'Internal server error' });
      return;
    }
    next();
  });

  // ── Static files (production only) ─────────────────────────────────────────
  const STATIC_DIR = process.env.STATIC_DIR || '';
  if (STATIC_DIR && existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
    app.get('{*path}', (_req, res) => {
      res.sendFile(path.resolve(STATIC_DIR, 'index.html'));
    });
  }

  return app;
}
