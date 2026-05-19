import { Music, Film, X, Trash2 } from 'lucide-react';
import { useMediaPlayer } from '../../hooks/useMediaPlayer';

export default function QueuePanel() {
  const { state, jumpTo, removeFromQueue, clearQueue } = useMediaPlayer();
  const { queue, currentIndex } = state;

  if (queue.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-[var(--color-text-faint)]">
        Queue is empty
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-light)]">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
          Queue — {queue.length} item{queue.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={clearQueue}
          className="text-xs text-[var(--color-text-faint)] hover:text-red-500 transition flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" />Clear
        </button>
      </div>
      <ul className="overflow-y-auto max-h-52">
        {queue.map((item, i) => {
          const isCurrent = i === currentIndex;
          return (
            <li
              key={item.id}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition group ${isCurrent ? 'bg-[var(--color-bg-muted)]' : 'hover:bg-[var(--color-bg-muted)]/50'}`}
              onClick={() => jumpTo(i)}
            >
              <span className="shrink-0 text-[var(--color-text-faint)]">
                {item.mediaType === 'video'
                  ? <Film className="w-4 h-4" />
                  : <Music className="w-4 h-4" />}
              </span>
              <span className={`flex-1 text-sm truncate ${isCurrent ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-sub)]'}`}>
                {item.name}
              </span>
              {isCurrent && (
                <span className="shrink-0 flex gap-0.5">
                  <span className="w-0.5 h-3 bg-[var(--color-progress-fill)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-0.5 h-3 bg-[var(--color-progress-fill)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-0.5 h-3 bg-[var(--color-progress-fill)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--color-text-faint)] hover:text-red-500 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
