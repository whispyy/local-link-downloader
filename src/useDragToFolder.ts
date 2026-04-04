import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook that provides both mouse (HTML5 DnD) and touch (long-press) drag
 * to move files into subfolder rows in the browse table.
 *
 * Usage:
 *   const drag = useDragToFolder(onMoveFile);
 *   <tr {...drag.fileRow(filename)}>        — draggable file row
 *   <tr {...drag.dirRow(dirName)}>          — drop target directory row
 *   <tr {...drag.backRow()}>                — drop target ".." row
 */

const LONG_PRESS_MS = 400;
const DRAG_DATA_TYPE = 'text/x-browse-filename';
const DROP_TARGET_ATTR = 'data-drop-target';
const DROP_TARGET_CLASS = 'drop-target-highlight';

export interface DragToFolderActions {
  fileRow: (filename: string) => Record<string, unknown>;
  dirRow: (dirName: string) => Record<string, unknown>;
  backRow: () => Record<string, unknown>;
}

export function useDragToFolder(
  onMove: (filename: string, targetDirName: string | '..') => void,
): DragToFolderActions {
  // ── Touch state ────────────────────────────────────────────────────────────
  const touchState = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    dragging: boolean;
    filename: string;
    ghost: HTMLDivElement | null;
    currentTarget: HTMLElement | null;
    startX: number;
    startY: number;
  }>({
    timer: null,
    dragging: false,
    filename: '',
    ghost: null,
    currentTarget: null,
    startX: 0,
    startY: 0,
  });

  // Cleanup on unmount
  useEffect(() => {
    const s = touchState.current;
    return () => {
      if (s.timer) clearTimeout(s.timer);
      if (s.ghost) s.ghost.remove();
    };
  }, []);

  // Non-passive document touchmove listener so preventDefault() can suppress
  // scroll while dragging. React synthetic events on individual rows cannot
  // reliably prevent scroll because the browser commits to a scroll gesture
  // before the long-press timer fires.
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (touchState.current.dragging) e.preventDefault();
    };
    document.addEventListener('touchmove', handler, { passive: false });
    return () => document.removeEventListener('touchmove', handler);
  }, []);

  // ── Touch helpers ──────────────────────────────────────────────────────────

  const removeGhost = useCallback(() => {
    const s = touchState.current;
    if (s.ghost) {
      s.ghost.remove();
      s.ghost = null;
    }
  }, []);

  const clearHighlight = useCallback(() => {
    const s = touchState.current;
    if (s.currentTarget) {
      s.currentTarget.classList.remove(DROP_TARGET_CLASS);
      s.currentTarget = null;
    }
  }, []);

  const findDropTarget = useCallback((x: number, y: number): HTMLElement | null => {
    // Temporarily hide ghost so elementFromPoint hits the row underneath
    const s = touchState.current;
    if (s.ghost) s.ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (s.ghost) s.ghost.style.display = '';
    if (!el) return null;
    // Walk up to find the <tr> with the drop target attribute
    const row = el.closest(`[${DROP_TARGET_ATTR}]`) as HTMLElement | null;
    return row;
  }, []);

  // ── Touch event handlers (attached to file rows) ───────────────────────────

  const onTouchStart = useCallback((filename: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    const s = touchState.current;
    s.startX = touch.clientX;
    s.startY = touch.clientY;
    s.filename = filename;

    // Start long-press timer
    s.timer = setTimeout(() => {
      s.timer = null;
      s.dragging = true;

      // Create ghost element
      const ghost = document.createElement('div');
      ghost.textContent = filename;
      ghost.className = 'drag-ghost';
      ghost.style.cssText =
        'position:fixed;z-index:9999;pointer-events:none;' +
        'padding:6px 12px;border-radius:8px;font-size:13px;' +
        'background:rgba(147,51,234,0.9);color:white;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.3);' +
        'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        `left:${touch.clientX + 12}px;top:${touch.clientY - 20}px;`;
      document.body.appendChild(ghost);
      s.ghost = ghost;
    }, LONG_PRESS_MS);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = touchState.current;
    const touch = e.touches[0];

    // If not yet dragging, cancel long-press if finger moved too far
    if (!s.dragging) {
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;
      if (dx * dx + dy * dy > 100) { // ~10px threshold
        if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      }
      return;
    }

    // Prevent scroll while dragging
    e.preventDefault();

    // Move ghost
    if (s.ghost) {
      s.ghost.style.left = `${touch.clientX + 12}px`;
      s.ghost.style.top = `${touch.clientY - 20}px`;
    }

    // Highlight drop target
    const target = findDropTarget(touch.clientX, touch.clientY);
    if (target !== s.currentTarget) {
      clearHighlight();
      if (target) {
        target.classList.add(DROP_TARGET_CLASS);
        s.currentTarget = target;
      }
    }
  }, [findDropTarget, clearHighlight]);

  const onTouchEnd = useCallback(() => {
    const s = touchState.current;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }

    if (s.dragging && s.currentTarget) {
      const dirName = s.currentTarget.getAttribute(DROP_TARGET_ATTR) || '';
      if (dirName) {
        onMove(s.filename, dirName);
      }
    }

    s.dragging = false;
    s.filename = '';
    removeGhost();
    clearHighlight();
  }, [onMove, removeGhost, clearHighlight]);

  // ── Mouse DnD handlers ─────────────────────────────────────────────────────

  const onDragStart = useCallback((filename: string, e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_DATA_TYPE, filename);
    e.dataTransfer.effectAllowed = 'move';
    // Dim the source row after a tick so the browser captures the snapshot first
    const row = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => row.classList.add('opacity-50'));
  }, []);

  const onDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('opacity-50');
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_DATA_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_DATA_TYPE)) {
      (e.currentTarget as HTMLElement).classList.add(DROP_TARGET_CLASS);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only remove highlight when leaving the row itself, not child elements
    const row = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !row.contains(related)) {
      row.classList.remove(DROP_TARGET_CLASS);
    }
  }, []);

  const onDrop = useCallback((dirName: string, e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove(DROP_TARGET_CLASS);
    const filename = e.dataTransfer.getData(DRAG_DATA_TYPE);
    if (filename) {
      onMove(filename, dirName);
    }
  }, [onMove]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const fileRow = useCallback((filename: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => onDragStart(filename, e),
    onDragEnd,
    onTouchStart: (e: React.TouchEvent) => onTouchStart(filename, e),
    onTouchMove,
    onTouchEnd,
  }), [onDragStart, onDragEnd, onTouchStart, onTouchMove, onTouchEnd]);

  const dirRow = useCallback((dirName: string) => ({
    [DROP_TARGET_ATTR]: dirName,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop: (e: React.DragEvent) => onDrop(dirName, e),
  }), [onDragOver, onDragEnter, onDragLeave, onDrop]);

  const backRow = useCallback(() => ({
    [DROP_TARGET_ATTR]: '..',
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop: (e: React.DragEvent) => onDrop('..', e),
  }), [onDragOver, onDragEnter, onDragLeave, onDrop]);

  return { fileRow, dirRow, backRow };
}
