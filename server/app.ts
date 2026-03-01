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
import { randomUUID, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, appendFile, unlink } from 'fs/promises';
import path from 'path';

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
  type?: 'http' | 'torrent';
  peers?: number;
  downloadSpeed?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  torrentRef?: any;
}

// ─── WebTorrent client (lazy singleton) ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wtClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getWTClient(): any {
  if (!_wtClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WTC = require('webtorrent');
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
    appendFile(LOG_FILE, line).catch(() => {});
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function createSession(sessions: Map<string, number>): string {
  const token = randomUUID();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  for (const [t, exp] of sessions) {
    if (Date.now() > exp) sessions.delete(t);
  }
  return token;
}

export function isValidSession(sessions: Map<string, number>, token: string): boolean {
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
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

export function isInternalIP(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);
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
      const chunks: Buffer[] = [];
      let downloaded = 0;
      let lastReported = 0;
      const THROTTLE_BYTES = 512 * 1024;
      const reader = response.body.getReader();
      while (true) {
        if (signal.aborted) {
          await reader.cancel();
          return { success: false, cancelled: true };
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        downloaded += chunk.length;
        const threshold = total ? Math.max(total * 0.01, THROTTLE_BYTES) : THROTTLE_BYTES;
        if (downloaded - lastReported >= threshold) {
          lastReported = downloaded;
          onProgress?.(downloaded, total);
        }
      }
      onProgress?.(downloaded, total);
      const data = Buffer.concat(chunks);
      await writeFile(destPath, data);
      return { success: true, totalBytes: downloaded };
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
  const sessions = new Map<string, number>();

  // Resolve log path from env at buildApp() call time so tests can override LOG_DIR
  const log = makeLogger();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());

  // ── Auth helpers (scoped to this instance) ──────────────────────────────────
  function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!isAuthEnabled()) { next(); return; }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!isValidSession(sessions, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  // ── Rate limiter ────────────────────────────────────────────────────────────
  // Each buildApp() call creates its own in-memory rate-limit store, so
  // parallel test instances using different app objects don't share counters.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
  });

  // ── POST /api/auth ──────────────────────────────────────────────────────────
  app.post('/api/auth', authLimiter, (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ token: 'no-auth' });
      return;
    }
    const { password } = req.body as { password?: string };
    const expected = process.env.APP_PASSWORD!;
    const provided = password ?? '';
    const lengthMatch = provided.length === expected.length;
    const valueMatch =
      lengthMatch && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!valueMatch) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    const token = createSession(sessions);
    log('INFO', 'New session created');
    res.json({ token });
  });

  // ── GET /api/config ─────────────────────────────────────────────────────────
  app.get('/api/config', authMiddleware, (_req, res) => {
    const downloadFoldersEnv = process.env.DOWNLOAD_FOLDERS || '';
    const allowedExtensionsEnv = process.env.ALLOWED_EXTENSIONS || '';
    const folderMapping = parseFolderMapping(downloadFoldersEnv);
    const folders = Array.from(folderMapping.keys());
    const allowedExtensions = allowedExtensionsEnv
      .split(',')
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0);
    log('INFO', 'Config requested', { folders, allowedExtensions });
    res.json({ folders, allowedExtensions });
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

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed' });
      return;
    }

    if (isInternalIP(parsedUrl.hostname)) {
      res.status(400).json({ error: 'Internal/private IP addresses are not allowed' });
      return;
    }

    const folderMapping = parseFolderMapping(process.env.DOWNLOAD_FOLDERS || '');
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

    if (allowedExtensions.length > 0) {
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx === -1) {
        res.status(400).json({ error: 'File has no extension. An extension is required.' });
        return;
      }
      const fileExt = filename.substring(dotIdx).toLowerCase();
      if (!allowedExtensions.includes(fileExt)) {
        res.status(400).json({
          error: `File extension ${fileExt} is not allowed. Allowed: ${allowedExtensions.join(', ')}`,
        });
        return;
      }
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
      } else {
        j.status = 'error';
        j.message = result.message;
        log('ERROR', 'Download failed', { jobId, error: result.message });
      }

      // .unref() prevents this timer from keeping the Node process alive in tests
      setTimeout(() => { jobs.delete(jobId); }, 24 * 60 * 60 * 1000).unref();
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

  app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
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

    const folderMapping = parseFolderMapping(process.env.DOWNLOAD_FOLDERS || '');
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

    if (allowedExtensions.length > 0) {
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx === -1) {
        res.status(400).json({ error: 'File has no extension. An extension is required.' });
        return;
      }
      const fileExt = filename.substring(dotIdx).toLowerCase();
      if (!allowedExtensions.includes(fileExt)) {
        res.status(400).json({
          error: `File extension ${fileExt} is not allowed. Allowed: ${allowedExtensions.join(', ')}`,
        });
        return;
      }
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
    setTimeout(() => jobs.delete(jobId), 24 * 60 * 60 * 1000).unref();

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
    if (magnet && !magnet.startsWith('magnet:')) {
      res.status(400).json({ error: 'Invalid magnet link format' });
      return;
    }

    const folderMapping = parseFolderMapping(process.env.DOWNLOAD_FOLDERS || '');
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

    setImmediate(() => {
      const j = jobs.get(jobId);
      if (!j || j.status === 'cancelled') {
        // Job was cancelled before we got here — just ensure cleanup timer is set
        if (j) setTimeout(() => { jobs.delete(jobId); }, 24 * 60 * 60 * 1000).unref();
        return;
      }
      j.status = 'downloading';
      j.downloadedBytes = 0;
      j.updatedAt = new Date().toISOString();

      let client: ReturnType<typeof getWTClient>;
      try {
        client = getWTClient();
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        torrent.destroy();
        setTimeout(() => { jobs.delete(jobId); }, 24 * 60 * 60 * 1000).unref();
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
        setTimeout(() => { jobs.delete(jobId); }, 24 * 60 * 60 * 1000).unref();
      });
    });

    res.json({ id: jobId, status: 'queued', type: 'torrent' });
  });

  // ── GET /api/jobs ───────────────────────────────────────────────────────────
  app.get('/api/jobs', authMiddleware, (_req, res) => {
    const allJobs = Array.from(jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(
      allJobs.map((job) => ({
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
      })),
    );
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
    if (job.type === 'torrent' && job.torrentRef) {
      job.torrentRef.destroy();
      job.torrentRef = undefined;
      setTimeout(() => { jobs.delete(jobId); }, 24 * 60 * 60 * 1000).unref();
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
    res.json({
      id: job.id,
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
    });
  });

  // ── Static files (production only) ─────────────────────────────────────────
  const STATIC_DIR = process.env.STATIC_DIR || '';
  if (STATIC_DIR && existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(STATIC_DIR, 'index.html'));
    });
  }

  return app;
}
