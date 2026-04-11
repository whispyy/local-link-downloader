import { Loader2 } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
}

const THRESHOLD = 80;

export default function PullToRefreshIndicator({ pullDistance, refreshing }: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !refreshing) return null;

  const progress = Math.min(1, pullDistance / THRESHOLD);
  const triggered = pullDistance >= THRESHOLD || refreshing;
  // Only animate height when snapping back to refresh state, not during active pull
  const animateHeight = refreshing && pullDistance > 0;

  return (
    <div
      className="flex items-center justify-center overflow-hidden"
      style={{
        height: refreshing ? 48 : pullDistance * 0.6,
        transition: animateHeight ? 'height 300ms ease-out' : 'none',
      }}
    >
      <div
        style={{
          opacity: triggered ? 1 : 0.4 + progress * 0.6,
          transform: refreshing ? undefined : `rotate(${progress * 360}deg)`,
          transition: refreshing ? 'opacity 200ms' : 'none',
        }}
      >
        <Loader2
          className={`w-5 h-5 text-th-text-dim ${refreshing ? 'animate-spin' : ''}`}
        />
      </div>
    </div>
  );
}
