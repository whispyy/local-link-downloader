import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, appendFile } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

// Log file path
const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_FILE = path.join(LOG_DIR, 'downloads.log');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// In-memory job store
interface DownloadJob {
  id: string;
  url: string;
  folderKey: string;
  filename: string;
  status: 'queued' | 'downloading' | 'done' | 'error';
  message?: string;
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, DownloadJob>();

// Logging utility
function log(level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  const line = `[${timestamp}] [${level}] ${message}${metaStr}\n`;
  process.stdout.write(line);
  appendFile(LOG_FILE, line).catch(() => {
    // ignore log write errors
  });
}

// Parse DOWNLOAD_FOLDERS env var: "key1:/path1;key2:/path2"
function parseFolderMapping(downloadFoldersEnv: string): Map<string, string> {
  const mapping = new Map<string, string>();
  if (!downloadFoldersEnv) return mapping;

  const pairs = downloadFoldersEnv.split(';');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const key = pair.substring(0, colonIdx).trim();
    const folderPath = pair.substring(colonIdx + 1).trim();
    if (key && folderPath) {
      mapping.set(key, folderPath);
    }
  }
  return mapping;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
}

function isInternalIP(hostname: string): boolean {
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

async function downloadFile(url: string, destPath: string): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });

    if (!response.ok) {
      return { success: false, message: `HTTP error: ${response.status} ${response.statusText}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    await writeFile(destPath, data);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Download failed',
    };
  }
}

app.use(cors());
app.use(express.json());

// GET /api/config - return folder keys and allowed extensions
app.get('/api/config', (_req, res) => {
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

// POST /api/download - start a download job
app.post('/api/download', async (req, res) => {
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

  const downloadFoldersEnv = process.env.DOWNLOAD_FOLDERS || '';
  const folderMapping = parseFolderMapping(downloadFoldersEnv);

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

  if (!filename || filename === '') {
    filename = 'download';
  }

  const allowedExtensionsEnv = process.env.ALLOWED_EXTENSIONS || '';
  const allowedExtensions = allowedExtensionsEnv
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

  // Prevent path traversal
  const resolvedDest = path.resolve(destinationFolder);
  const resolvedFull = path.resolve(fullPath);
  if (!resolvedFull.startsWith(resolvedDest + path.sep)) {
    res.status(400).json({ error: 'Path traversal detected' });
    return;
  }

  // Ensure destination folder exists
  if (!existsSync(destinationFolder)) {
    mkdirSync(destinationFolder, { recursive: true });
  }

  const jobId = randomUUID();
  const now = new Date().toISOString();

  const job: DownloadJob = {
    id: jobId,
    url,
    folderKey,
    filename,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(jobId, job);
  log('INFO', 'Download job created', { jobId, url, folderKey, filename });

  // Start download asynchronously
  setImmediate(async () => {
    const j = jobs.get(jobId)!;
    j.status = 'downloading';
    j.updatedAt = new Date().toISOString();
    log('INFO', 'Download started', { jobId, url, fullPath });

    const result = await downloadFile(url, fullPath);

    j.updatedAt = new Date().toISOString();
    if (result.success) {
      j.status = 'done';
      j.message = `Downloaded to ${fullPath}`;
      log('INFO', 'Download completed', { jobId, fullPath });
    } else {
      j.status = 'error';
      j.message = result.message;
      log('ERROR', 'Download failed', { jobId, error: result.message });
    }

    // Evict completed/failed jobs after 24 hours to prevent unbounded memory growth
    setTimeout(() => {
      jobs.delete(jobId);
    }, 24 * 60 * 60 * 1000);
  });

  res.json({ id: jobId, status: 'queued' });
});

// GET /api/jobs - list all jobs sorted by createdAt descending
app.get('/api/jobs', (_req, res) => {
  const allJobs = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  res.json(
    allJobs.map((job) => ({
      id: job.id,
      url: job.url,
      status: job.status,
      message: job.message,
      filename: job.filename,
      folder_key: job.folderKey,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    }))
  );
});

// GET /api/status/:jobId - get job status
app.get('/api/status/:jobId', (req, res) => {
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
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  });
});

// Serve built frontend static files in production
const STATIC_DIR = process.env.STATIC_DIR || '';
if (STATIC_DIR && existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  // SPA fallback: serve index.html for any non-API route
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(STATIC_DIR, 'index.html'));
  });
  log('INFO', `Serving static files from ${path.resolve(STATIC_DIR)}`);
}

app.listen(PORT, () => {
  log('INFO', `Web Downloader API server running on port ${PORT}`);
  log('INFO', `Log file: ${path.resolve(LOG_FILE)}`);
});
