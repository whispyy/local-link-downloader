import { useRef, useEffect, useState, useCallback } from 'react';

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

interface PullToRefreshResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pullDistance: number;
  refreshing: boolean;
}

export function usePullToRefresh(onRefresh: () => Promise<void>): PullToRefreshResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const pulling = useRef(false);
  const currentDistance = useRef(0);
  const rafId = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Batch state updates via rAF to avoid re-render on every touchmove pixel
  const scheduleUpdate = useCallback((distance: number) => {
    currentDistance.current = distance;
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      setPullDistance(currentDistance.current);
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshingRef.current) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
      currentDistance.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        const distance = Math.min(MAX_PULL, dy * 0.5);
        scheduleUpdate(distance);
      } else {
        pulling.current = false;
        currentDistance.current = 0;
        scheduleUpdate(0);
      }
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;

      // Cancel any pending rAF
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }

      const dist = currentDistance.current;
      if (dist >= PULL_THRESHOLD && !refreshingRef.current) {
        setPullDistance(dist);
        setRefreshing(true);
        onRefreshRef.current().finally(() => {
          setRefreshing(false);
          setPullDistance(0);
          currentDistance.current = 0;
        });
      } else {
        setPullDistance(0);
        currentDistance.current = 0;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [scheduleUpdate]);

  return { containerRef, pullDistance, refreshing };
}
