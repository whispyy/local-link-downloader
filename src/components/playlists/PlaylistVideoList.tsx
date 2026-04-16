import { Loader2, RotateCcw, ExternalLink, RefreshCw } from 'lucide-react';
import type { PlaylistVideo } from './types';
import { statusBadge } from './types';

interface PlaylistVideoListProps {
  videos: PlaylistVideo[];
  loading: boolean;
  syncing: boolean;
  retrying: string | null;
  failedCount: number;
  onSync: () => void;
  onRetry: (videoIds?: string[]) => void;
}

export default function PlaylistVideoList({ videos, loading, syncing, retrying, failedCount, onSync, onRetry }: PlaylistVideoListProps) {
  return (
    <div className="border-t border-th-border-light px-4 py-3">
      {/* Actions bar */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt disabled:opacity-50 transition text-th-text-sub"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync Now
        </button>
        {failedCount > 0 && (
          <button
            onClick={() => onRetry()}
            disabled={retrying !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 text-red-600 border border-red-500/20 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition"
          >
            {retrying === 'all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Retry All Failed ({failedCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-th-text-dim py-4 justify-center text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading videos...
        </div>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {videos.map((v) => (
            <div key={v.videoId} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-th-bg-alt text-sm">
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusBadge(v.status)}`}>
                {v.status}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-th-text-sub truncate block" title={v.title || v.videoId}>
                  {v.title || v.videoId}
                </span>
                {v.status === 'downloading' && v.liveProgress && v.liveProgress.percent != null && v.liveProgress.percent >= 0 && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1 rounded-full bg-th-bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${v.liveProgress.phase === 'postprocessing' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'}`}
                        style={{ width: v.liveProgress.phase === 'postprocessing' ? '100%' : `${Math.max(0, Math.min(100, Math.round(v.liveProgress.percent)))}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-th-text-faint shrink-0">
                      {v.liveProgress.phase === 'postprocessing' ? 'Converting...' : `${Math.round(v.liveProgress.percent)}%`}
                    </span>
                  </div>
                )}
                {v.status === 'failed' && v.error && (
                  <span className="text-[10px] text-red-500 truncate block" title={v.error}>
                    {v.error}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={`https://www.youtube.com/watch?v=${v.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-th-text-faint hover:text-th-text-sub transition"
                  title="Open on YouTube"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
                {(v.status === 'failed' || v.status === 'cancelled') && (
                  <button
                    onClick={() => onRetry([v.videoId])}
                    disabled={retrying !== null}
                    title="Retry"
                    className="p-1 text-th-text-faint hover:text-th-text-sub transition disabled:opacity-50"
                  >
                    {retrying === v.videoId ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {videos.length === 0 && (
            <p className="text-xs text-th-text-faint text-center py-4">No videos synced yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
