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

export interface PlaylistVideo {
  videoId: string;
  status: VideoStatus['status'];
  title?: string;
  error?: string;
  jobId?: string;
  lastAttemptAt?: string;
  liveProgress?: {
    percent?: number;
    speed?: string;
    eta?: string;
    phase?: string;
  };
}

export const INTERVAL_PRESETS = [1, 3, 6, 12, 24];

export function statusBadge(status: VideoStatus['status']) {
  switch (status) {
    case 'done': return 'bg-green-500/15 text-green-600';
    case 'failed': return 'bg-red-500/15 text-red-600';
    case 'downloading': return 'bg-blue-500/15 text-blue-600';
    case 'cancelled': return 'bg-yellow-500/15 text-yellow-600';
    case 'pending': return 'bg-th-bg-muted text-th-text-dim';
  }
}

export function videoCountSummary(videoStatuses: Record<string, VideoStatus>) {
  const entries = Object.values(videoStatuses);
  const done = entries.filter((v) => v.status === 'done').length;
  const failed = entries.filter((v) => v.status === 'failed').length;
  const cancelled = entries.filter((v) => v.status === 'cancelled').length;
  const downloading = entries.filter((v) => v.status === 'downloading').length;
  const total = entries.length;
  return { done, failed, cancelled, downloading, total };
}
