import { Trash2, ChevronDown } from 'lucide-react';
import type { Playlist, PlaylistVideo } from './types';
import { videoCountSummary, INTERVAL_PRESETS } from './types';
import PlaylistVideoList from './PlaylistVideoList';

interface PlaylistCardProps {
  playlist: Playlist;
  isExpanded: boolean;
  videos: PlaylistVideo[];
  loadingVideos: boolean;
  syncing: boolean;
  retrying: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onSync: () => void;
  onRetry: (videoIds?: string[]) => void;
  onIntervalChange: (hours: number) => void;
}

export default function PlaylistCard({
  playlist: pl,
  isExpanded,
  videos,
  loadingVideos,
  syncing,
  retrying,
  onToggle,
  onRemove,
  onExpand,
  onSync,
  onRetry,
  onIntervalChange,
}: PlaylistCardProps) {
  const counts = videoCountSummary(pl.videoStatuses);

  return (
    <div
      className={`rounded-lg border transition ${
        pl.enabled
          ? 'bg-th-bg border-th-border-light'
          : 'bg-th-bg/60 border-th-border-lighter'
      }`}
    >
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${pl.enabled ? 'text-th-text' : 'text-th-text-dim'}`} title={pl.title || pl.url}>
              {pl.title || pl.url}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full bg-th-bg-muted text-th-text-dim">
                {pl.folderKey}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                pl.format === 'video'
                  ? 'bg-blue-500/15 text-blue-600'
                  : 'bg-purple-500/15 text-purple-600'
              }`}>
                {pl.format === 'video' ? 'Video' : 'Audio'}
              </span>
              <span className="text-xs text-th-text-faint">
                every {pl.syncIntervalHours}h
              </span>
              {counts.total > 0 && (
                <>
                  <span className="text-xs text-green-600">
                    {counts.done} done
                  </span>
                  {counts.failed > 0 && (
                    <span className="text-xs text-red-600">
                      {counts.failed} failed
                    </span>
                  )}
                  {counts.cancelled > 0 && (
                    <span className="text-xs text-yellow-600">
                      {counts.cancelled} cancelled
                    </span>
                  )}
                  {counts.downloading > 0 && (
                    <span className="text-xs text-blue-600">
                      {counts.downloading} downloading
                    </span>
                  )}
                </>
              )}
            </div>
            {pl.lastSyncAt && (
              <p className="text-xs text-th-text-faint mt-1">
                Last sync: {new Date(pl.lastSyncAt).toLocaleString()}
                {pl.lastSyncError && (
                  <span className="text-red-500 ml-1" title={pl.lastSyncError}>
                    (error)
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={pl.enabled}
              onClick={onToggle}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                pl.enabled ? 'bg-th-btn' : 'bg-th-bg-muted'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  pl.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
            <button
              onClick={onRemove}
              title="Remove"
              className="p-1.5 text-th-text-faint hover:text-red-500 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onExpand}
              title={isExpanded ? 'Collapse' : 'Expand'}
              className="p-1.5 text-th-text-faint hover:text-th-text-sub transition"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Interval selector */}
      {pl.enabled && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-th-text-faint">Interval:</span>
          {INTERVAL_PRESETS.map((h) => (
            <button
              key={h}
              onClick={() => onIntervalChange(h)}
              className={`px-2 py-0.5 rounded-md text-xs font-medium transition border ${
                pl.syncIntervalHours === h
                  ? 'bg-th-btn text-th-btn-text border-th-btn'
                  : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      )}

      {/* Expanded video list */}
      {isExpanded && (
        <PlaylistVideoList
          videos={videos}
          loading={loadingVideos}
          syncing={syncing}
          retrying={retrying}
          failedCount={counts.failed + counts.cancelled}
          onSync={onSync}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}
