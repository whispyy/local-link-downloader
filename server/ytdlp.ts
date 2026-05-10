/**
 * server/ytdlp.ts
 *
 * yt-dlp integration: single downloads and playlist sync.
 * Spawns yt-dlp as a child process (same pattern as ffmpeg in transcode.ts).
 */

import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { ensureDataDir } from './autoclean';

const DATA_DIR = process.env.DATA_DIR || './data';
const CONFIG_FILE = path.join(DATA_DIR, 'playlists.json');

// ─── Progress parsing ────────────────────────────────────────────────────────

export interface YtdlpProgress {
  percent: number;
  speed: string;
  eta: string;
  phase: 'downloading' | 'postprocessing';
}

/**
 * Parses a yt-dlp stdout line for progress info.
 * Example: "[download]  45.3% of  150.25MiB at  2.50MiB/s ETA 00:35"
 */
export function parseProgress(line: string): YtdlpProgress | null {
  // Download progress line
  const dlMatch = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+[\S]+\s+at\s+([\S]+)\s+ETA\s+(\S+)/,
  );
  if (dlMatch) {
    return {
      percent: parseFloat(dlMatch[1]),
      speed: dlMatch[2],
      eta: dlMatch[3],
      phase: 'downloading',
    };
  }

  // 100% complete line: "[download] 100% of 150.25MiB in 00:35"
  if (/\[download\]\s+100%/.test(line)) {
    return { percent: 100, speed: '', eta: '', phase: 'downloading' };
  }

  // Post-processing phases
  if (
    line.startsWith('[Merger]') ||
    line.startsWith('[ExtractAudio]') ||
    line.startsWith('[ffmpeg]') ||
    line.startsWith('[FixupM3u8]')
  ) {
    return { percent: -1, speed: '', eta: '', phase: 'postprocessing' };
  }

  return null;
}

// ─── Title resolution ────────────────────────────────────────────────────────

export function fetchVideoTitle(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('yt-dlp', ['--print', 'title', '--no-download', '--no-playlist', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().split('\n')[0]);
      } else {
        resolve(null);
      }
    });
  });
}

export function fetchPlaylistTitle(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('yt-dlp', ['--print', 'playlist_title', '--playlist-items', '1', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const title = stdout.trim().split('\n')[0];
      if (code === 0 && title && title !== 'NA') {
        resolve(title);
      } else {
        resolve(null);
      }
    });
  });
}

// ─── Single download ─────────────────────────────────────────────────────────

export interface YtdlpResult {
  success: boolean;
  cancelled?: boolean;
  filename?: string;
  message?: string;
}

export function runYtdlp(
  url: string,
  destDir: string,
  format: 'video' | 'audio',
  signal: AbortSignal,
  onProgress?: (progress: YtdlpProgress) => void,
): Promise<YtdlpResult> {
  return new Promise((resolve) => {
    const args: string[] = [];

    if (format === 'audio') {
      args.push('-x', '--audio-format', 'mp3');
    } else {
      args.push(
        '-f', 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--merge-output-format', 'mp4',
      );
    }

    args.push(
      '--newline',
      '--restrict-filenames',
      '--no-playlist',
      '-o', '%(title)s.%(ext)s',
      url,
    );

    let child: ChildProcess;
    try {
      child = spawn('yt-dlp', args, { cwd: destDir, stdio: ['ignore', 'pipe', 'pipe'] });
      child.unref();
      // Prevent the stdio pipe handles from keeping the event loop alive.
      // These are net.Socket instances and support unref().
      (child.stdout as unknown as { unref?: () => void })?.unref?.();
      (child.stderr as unknown as { unref?: () => void })?.unref?.();
    } catch (err) {
      resolve({ success: false, message: `Failed to spawn yt-dlp: ${err}` });
      return;
    }

    let lastFilename = '';
    let stderr = '';
    let resolved = false;

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        // Capture destination filename
        const destMatch = line.match(/\[(?:download|Merger|ExtractAudio)\]\s+Destination:\s+(.+)/);
        if (destMatch) {
          lastFilename = path.basename(destMatch[1].trim());
        } else {
          // "Merging formats into" line (final merged output filename)
          const mergeMatch = line.match(/\[Merger\]\s+Merging formats into "(.+)"/);
          if (mergeMatch) {
            lastFilename = path.basename(mergeMatch[1].trim());
          }
        }

        const progress = parseProgress(line);
        if (progress) onProgress?.(progress);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener('abort', onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ success: false, message: `yt-dlp process error: ${err.message}` });
    });

    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener('abort', onAbort);

      if (signal.aborted) {
        resolve({ success: false, cancelled: true, filename: lastFilename || undefined });
        return;
      }

      if (code === 0) {
        resolve({ success: true, filename: lastFilename || undefined });
      } else {
        // Extract useful error from stderr
        const errLines = stderr.trim().split('\n');
        const errorMsg = errLines[errLines.length - 1] || `yt-dlp exited with code ${code}`;
        resolve({ success: false, message: errorMsg });
      }
    });
  });
}

// ─── Playlist config ─────────────────────────────────────────────────────────

export interface VideoStatus {
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled';
  title?: string;
  error?: string;
  jobId?: string;
  lastAttemptAt?: string;
}

export interface Playlist {
  id: string;
  url: string;
  title?: string;
  folderKey: string;
  format: 'video' | 'audio';
  enabled: boolean;
  syncIntervalHours: number;
  videoStatuses: Record<string, VideoStatus>;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

interface PlaylistConfig {
  playlists: Playlist[];
}

export function loadPlaylistsSync(): Playlist[] {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const config: PlaylistConfig = JSON.parse(raw);
    return config.playlists || [];
  } catch {
    return [];
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  ensureDataDir();
  const config: PlaylistConfig = { playlists };
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ─── Fetch playlist video IDs ────────────────────────────────────────────────

export function fetchPlaylistVideoIds(url: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', ['--flat-playlist', '--yes-playlist', '--print', 'id', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      const ids = stdout.trim().split('\n').filter(Boolean);
      resolve(ids);
    });
  });
}

// ─── Playlist sync ───────────────────────────────────────────────────────────

type LogFn = (level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) => void;

type CreateJobFn = (videoId: string, playlistId: string, playlistUrl: string, folderKey: string, format: 'video' | 'audio') => string;

export interface JobCompleteResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  title?: string;
}

export interface PlaylistSyncHandle {
  getPlaylists(): Playlist[];
  updatePlaylists(playlists: Playlist[]): void;
  syncPlaylist(id: string): Promise<void>;
  syncAll(): Promise<void>;
  handleJobComplete(playlistId: string, videoId: string, result: JobCompleteResult): void;
  stop(): void;
}

export function startPlaylistSync(
  folderMapping: Map<string, string>,
  log: LogFn,
  initialPlaylists: Playlist[],
  createJob: CreateJobFn,
): PlaylistSyncHandle {
  let currentPlaylists: Playlist[] = initialPlaylists;
  const syncingIds = new Set<string>();

  async function syncOne(playlist: Playlist): Promise<void> {
    if (!playlist.enabled) return;
    if (syncingIds.has(playlist.id)) return;
    if (!folderMapping.has(playlist.folderKey)) {
      log('WARN', 'Playlist sync: unknown folder key', { playlistId: playlist.id, folderKey: playlist.folderKey });
      return;
    }
    syncingIds.add(playlist.id);

    log('INFO', 'Playlist sync: fetching video IDs', { playlistId: playlist.id, url: playlist.url });
    try {
      const allIds = await fetchPlaylistVideoIds(playlist.url);
      const knownIds = new Set(Object.keys(playlist.videoStatuses));
      const newIds = allIds.filter((id) => !knownIds.has(id));

      if (newIds.length > 0) {
        log('INFO', 'Playlist sync: found new videos', { playlistId: playlist.id, count: newIds.length });
        for (const videoId of newIds) {
          const jobId = createJob(videoId, playlist.id, playlist.url, playlist.folderKey, playlist.format);
          playlist.videoStatuses[videoId] = {
            status: 'downloading',
            jobId,
            lastAttemptAt: new Date().toISOString(),
          };
        }
      }

      playlist.lastSyncAt = new Date().toISOString();
      playlist.lastSyncError = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('ERROR', `Playlist sync failed for "${playlist.title || playlist.url}" (${playlist.id})`, { playlistId: playlist.id, url: playlist.url, folder: playlist.folderKey, error: msg });
      playlist.lastSyncAt = new Date().toISOString();
      playlist.lastSyncError = msg;
    }

    await savePlaylists(currentPlaylists).catch((e) => {
      log('ERROR', `Playlist sync: failed to save config after syncing "${playlist.title || playlist.url}"`, { playlistId: playlist.id, error: String(e) });
    });
    syncingIds.delete(playlist.id);
  }

  async function tick(): Promise<void> {
    const now = Date.now();
    for (const pl of currentPlaylists) {
      if (!pl.enabled) continue;
      const intervalMs = pl.syncIntervalHours * 60 * 60 * 1000;
      const lastSync = pl.lastSyncAt ? new Date(pl.lastSyncAt).getTime() : 0;
      if (now - lastSync >= intervalMs) {
        await syncOne(pl);
      }
    }
  }

  // Initial sync after 10 seconds
  const startTimer = setTimeout(() => {
    tick().catch((err) => log('ERROR', 'Playlist sync: tick failed', { error: String(err) }));
  }, 10_000);
  startTimer.unref();

  // Periodic check every 60 seconds
  const interval = setInterval(() => {
    tick().catch((err) => log('ERROR', 'Playlist sync: tick failed', { error: String(err) }));
  }, 60_000);
  interval.unref();

  return {
    getPlaylists() {
      return currentPlaylists;
    },
    updatePlaylists(playlists: Playlist[]) {
      currentPlaylists = playlists;
    },
    async syncPlaylist(id: string) {
      const pl = currentPlaylists.find((p) => p.id === id);
      if (!pl) throw new Error(`Playlist not found: ${id}`);
      await syncOne(pl);
    },
    async syncAll() {
      for (const pl of currentPlaylists) {
        if (pl.enabled) await syncOne(pl);
      }
    },
    stop() {
      clearTimeout(startTimer);
      clearInterval(interval);
    },
    handleJobComplete(playlistId: string, videoId: string, result: JobCompleteResult) {
      const pl = currentPlaylists.find((p) => p.id === playlistId);
      if (!pl) return;
      const vs = pl.videoStatuses[videoId];
      if (!vs) return;
      if (result.success) {
        vs.status = 'done';
        vs.error = undefined;
      } else if (result.cancelled) {
        vs.status = 'cancelled';
      } else {
        vs.status = 'failed';
        vs.error = result.error;
      }
      if (result.title) vs.title = result.title;
      vs.lastAttemptAt = new Date().toISOString();
      savePlaylists(currentPlaylists).catch((e) => {
        log('ERROR', `Failed to persist video status for "${pl.title || pl.url}" (video: ${videoId})`, { playlistId, videoId, error: String(e) });
      });
    },
  };
}
