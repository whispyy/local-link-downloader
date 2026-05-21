import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { Folder, Film, Music, Image, FileText, FileCode, Download, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2, RefreshCw, ArrowRightLeft, FolderPlus, MoreVertical, Pencil, WifiOff, CloudDownload, Loader2, ArrowUpDown, Play, ListPlus } from 'lucide-react';
import { useMediaPlayer, QueueItem } from '../hooks/useMediaPlayer';
import PageTitle from '../components/PageTitle';
import { formatBytes, formatDate, getMediaType } from '../utils';
import NavBar from '../components/NavBar';
import { useDragToFolder } from '../hooks/useDragToFolder';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';
import { useOfflineStore, OfflineFileMeta } from '../hooks/useOfflineStore';
import { useOutsideClick } from '../hooks/useOutsideClick';

const OFFLINE_FOLDER_KEY = '__offline__';

function truncateText(text: string, limit = 512_000): string {
  return text.length > limit ? text.slice(0, limit) + '\n\n… (truncated)' : text;
}

interface BrowseFile {
  name: string;
  size: number;
  modifiedAt: string;
  has_thumbnail?: boolean;
}

interface BrowsePageProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

interface NewFolderFormProps {
  name: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  className?: string;
  inputClassName?: string;
}

function NewFolderForm({ name, onChange, onConfirm, onCancel, loading, className = '', inputClassName = '' }: NewFolderFormProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <FolderPlus className="w-4 h-4 text-amber-500 shrink-0" />
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Folder name"
        className={`px-3 py-1.5 text-sm border border-th-border rounded-lg bg-th-bg text-th-text outline-none focus:ring-2 focus:ring-th-ring ${inputClassName}`}
      />
      <button
        onClick={onConfirm}
        disabled={loading || !name.trim()}
        className="px-3 py-1.5 text-sm font-medium bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Create'}
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1.5 text-sm text-th-text-dim hover:text-th-text transition"
      >
        Cancel
      </button>
    </div>
  );
}

function MediaIcon({ filename }: { filename: string }) {
  const type = getMediaType(filename);
  switch (type) {
    case 'video': return <Film className="w-4 h-4 text-purple-500" />;
    case 'audio': return <Music className="w-4 h-4 text-blue-500" />;
    case 'image': return <Image className="w-4 h-4 text-green-500" />;
    case 'text':  return <FileCode className="w-4 h-4 text-amber-500" />;
    default:      return <FileText className="w-4 h-4 text-th-text-faint" />;
  }
}

interface SortIconProps {
  active: boolean;
  order: 'asc' | 'desc';
}

function SortIcon({ active, order }: SortIconProps) {
  if (!active) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
  return order === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

interface MobileSortMenuProps {
  sortField: 'name' | 'size' | 'modified';
  sortOrder: 'asc' | 'desc';
  onSort: (field: 'name' | 'size' | 'modified') => void;
}

function MobileSortMenu({ sortField, sortOrder, onSort }: MobileSortMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, () => setOpen(false), open);

  return (
    <div className="relative sm:hidden flex items-center gap-1" ref={ref}>
      <span>Name</span>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-0.5 hover:text-th-text transition"
        title="Sort by…"
      >
        <SortIcon active={true} order={sortOrder} />
      </button>
      {sortField !== 'name' && (
        <span className="normal-case tracking-normal font-normal text-[10px] text-th-text-dim">
          {sortField === 'size' ? 'Size' : 'Date'}{sortOrder === 'asc' ? '↑' : '↓'}
        </span>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-th-bg border border-th-border-light rounded-lg shadow-lg py-1 min-w-[7rem] animate-scale-fade-in" style={{ transformOrigin: 'top left' }}>
          {(['name', 'size', 'modified'] as const).map((f) => {
            const label = f === 'name' ? 'Name' : f === 'size' ? 'Size' : 'Date';
            const isActive = sortField === f;
            return (
              <button
                key={f}
                onClick={() => { onSort(f); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-th-bg-alt transition ${isActive ? 'text-th-text font-semibold' : 'text-th-text-sub font-normal'}`}
              >
                <span>{label}</span>
                <SortIcon active={isActive} order={sortOrder} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface OfflineButtonProps {
  isSaving: boolean;
  isOffline: boolean;
  onSave: () => void;
  onRemove: () => void;
  compact?: boolean; // true = desktop icon-only, false = mobile with labels
}

function OfflineButton({ isSaving, isOffline, onSave, onRemove, compact = false }: OfflineButtonProps) {
  const icon = compact ? 'w-4 h-4' : 'w-3.5 h-3.5';
  if (isSaving) {
    return compact
      ? <span className="p-1.5" title="Saving offline…"><Loader2 className={`${icon} animate-spin text-green-500`} /></span>
      : <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-500"><Loader2 className={`${icon} animate-spin`} />Saving…</span>;
  }
  if (isOffline) {
    return compact
      ? <button onClick={onRemove} className="p-1.5 rounded text-green-500 hover:text-green-600 hover:bg-green-500/15 transition" title="Remove from offline"><WifiOff className={icon} /></button>
      : <button onClick={onRemove} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-green-600 bg-th-bg border border-green-500/20 transition"><WifiOff className={icon} />Offline</button>;
  }
  return compact
    ? <button onClick={onSave} className="p-1.5 rounded text-th-text-faint hover:text-green-500 hover:bg-green-500/10 transition" title="Save for offline"><CloudDownload className={icon} /></button>
    : <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition"><CloudDownload className={icon} />Save Offline</button>;
}


export default function BrowsePage({ token, onUnauthorized, authEnabled }: BrowsePageProps) {
  const [folders, setFolders] = useState<string[]>([]);
  const [freeSpace, setFreeSpace] = useState<Record<string, number>>({});
  const [folderKey, setFolderKey] = useState('');
  const [transcodingAvailable, setTranscodingAvailable] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [files, setFiles] = useState<BrowseFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const lastClickedIdx = useRef<number | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoRetryKey, setVideoRetryKey] = useState(0);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const closePreview = useCallback(() => {
    setPreviewFile(null); setVideoError(false); setVideoRetryKey(0); setTextContent(null);
  }, []);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null); // filename being moved
  const [moving, setMoving] = useState(false);
  const [subpath, setSubpath] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingLoading, setCreatingLoading] = useState(false);
  const [renamingDir, setRenamingDir] = useState<string | null>(null);
  const [renameDirValue, setRenameDirValue] = useState('');
  const [renameDirLoading, setRenameDirLoading] = useState(false);
  const [confirmDeleteDir, setConfirmDeleteDir] = useState<string | null>(null);
  const [deletingDir, setDeletingDir] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isOfflineFolder, setIsOfflineFolder] = useState(false);
  const offline = useOfflineStore();
  const [offlinePreviewUrl, setOfflinePreviewUrl] = useState<string | null>(null);
  const [renamingBreadcrumb, setRenamingBreadcrumb] = useState(false);
  const [renameBreadcrumbValue, setRenameBreadcrumbValue] = useState('');
  const [renameBreadcrumbLoading, setRenameBreadcrumbLoading] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameFileValue, setRenameFileValue] = useState('');
  const [renameFileLoading, setRenameFileLoading] = useState(false);
  const [confirmDeleteBreadcrumb, setConfirmDeleteBreadcrumb] = useState(false);
  const [deletingBreadcrumb, setDeletingBreadcrumb] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [sortField, setSortField] = useState<'name' | 'size' | 'modified'>('modified');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useOutsideClick(moreMenuRef, () => setMoreMenuOpen(false), moreMenuOpen);

  const authHeaders = useAuthHeaders(token);

  useEffect(() => {
    // When the server was unreachable at boot, token is 'offline' —
    // skip all API calls and go straight to the offline folder.
    if (token === 'offline') {
      setIsOfflineFolder(true);
      return;
    }
    fetch('/api/config', { headers: authHeaders })
      .then(res => {
        if (res.status === 401) { onUnauthorized(); return null; }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!data) return;
        setFolders(data.folders);
        if (data.freeSpace) setFreeSpace(data.freeSpace);
        if (data.folders.length > 0) {
          const saved = localStorage.getItem('lastFolderKey');
          const initial = saved && data.folders.includes(saved) ? saved : data.folders[0];
          setFolderKey(initial);
        }
        const tc = data.transcoding ?? false;
        setTranscodingAvailable(tc);
        setTranscoding(tc);
      })
      .catch((err) => {
        if (err instanceof TypeError) {
          // Network error (server unreachable) — fall back to offline-only mode
          setIsOfflineFolder(true);
        } else {
          // Server error (5xx, bad JSON, etc.) — show error to user
          setError(err.message || 'Could not load configuration');
        }
      });
  }, [token, authHeaders, onUnauthorized]);

  const fetchFiles = useCallback(async (signal?: AbortSignal) => {
    if (!folderKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}?page=${page}&limit=${limit}&subpath=${encodeURIComponent(subpath)}&sort=${sortField}&order=${sortOrder}`, {
        headers: authHeaders,
        signal,
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setFiles(data.files);
      setTotal(data.total);
      setDirs((data.dirs || []).map((d: { name: string }) => d.name));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [folderKey, page, limit, subpath, sortField, sortOrder, authHeaders, onUnauthorized]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFiles(controller.signal);
    return () => controller.abort();
  }, [fetchFiles]);

  const handleSort = useCallback((field: 'name' | 'size' | 'modified') => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'modified' ? 'desc' : 'asc');
    }
    setPage(1);
  }, [sortField]);

  // totalPages is calculated below, after offlineFileList is built

  const subpathParam = subpath ? `&subpath=${encodeURIComponent(subpath)}` : '';

  const fileUrl = useCallback((filename: string) =>
    `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}${subpathParam}`,
    [folderKey, token, subpathParam]);

  const thumbSubpath = subpath ? `${subpath}/.thumbnails` : '.thumbnails';
  const thumbUrl = useCallback((filename: string) =>
    `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}&subpath=${encodeURIComponent(thumbSubpath)}`,
    [folderKey, token, thumbSubpath]);

  const videoSrc = useCallback((filename: string) =>
    transcoding
      ? `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/stream?token=${encodeURIComponent(token)}${subpathParam}`
      : fileUrl(filename),
    [transcoding, folderKey, token, subpathParam, fileUrl]);

  const { playNow, addToQueue } = useMediaPlayer();

  const makeQueueItem = useCallback((file: BrowseFile): QueueItem | null => {
    const mediaType = getMediaType(file.name);
    if (mediaType !== 'audio' && mediaType !== 'video') return null;
    return {
      id: `${folderKey}::${subpath}::${file.name}`,
      name: file.name,
      url: mediaType === 'video' ? videoSrc(file.name) : fileUrl(file.name),
      mediaType,
    };
  }, [folderKey, subpath, fileUrl, videoSrc]);

  const makeOfflineQueueItem = useCallback(async (meta: OfflineFileMeta): Promise<QueueItem | null> => {
    const url = await offline.getOfflineUrl(meta.folderKey, meta.subpath, meta.name);
    if (!url) return null;
    return {
      id: `${meta.folderKey}::${meta.subpath}::${meta.name}`,
      name: meta.name,
      url,
      mediaType: meta.mediaType as 'audio' | 'video',
    };
  }, [offline.getOfflineUrl]);

  const resetSelection = useCallback(() => {
    setSelectedFiles(new Set());
    lastClickedIdx.current = null;
    closePreview();
  }, [closePreview]);

  const handleFolderChange = (key: string) => {
    setSortField('modified');
    setSortOrder('desc');
    if (key === OFFLINE_FOLDER_KEY) {
      setIsOfflineFolder(true);
      setFolderKey('');
      setSubpath('');
      setPage(1);
      resetSelection();
      return;
    }
    setIsOfflineFolder(false);
    setFolderKey(key);
    localStorage.setItem('lastFolderKey', key);
    setSubpath('');
    setPage(1);
    resetSelection();
  };

  const handleFileClick = useCallback((filename: string, fileIndex: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIdx.current !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIdx.current, fileIndex);
      const end = Math.max(lastClickedIdx.current, fileIndex);
      const currentFiles = isOfflineFolder ? offline.offlineFiles.map(f => f.key) : files.map(f => f.name);
      const rangeNames = currentFiles.slice(start, end + 1);
      setSelectedFiles(new Set(rangeNames));
    } else {
      setSelectedFiles(new Set([filename]));
      lastClickedIdx.current = fileIndex;
    }

    // Update media preview
    setPreviewFile(filename);
    setVideoError(false);
    setVideoRetryKey(0);
    setTextContent(null);
    const type = getMediaType(filename);
    if (type === 'text') {
      setTextLoading(true);
      if (isOfflineFolder) {
        // Load text content from offline blob
        const meta = offline.offlineFiles.find(f => f.key === filename);
        if (meta) {
          offline.getOfflineUrl(meta.folderKey, meta.subpath, meta.name)
            .then(url => url ? fetch(url) : Promise.reject())
            .then(res => res.text())
            .then(text => {
              setTextContent(truncateText(text));
            })
            .catch(() => setTextContent('Failed to load offline file content.'))
            .finally(() => setTextLoading(false));
        } else {
          setTextContent('File not found in offline store.');
          setTextLoading(false);
        }
      } else {
        fetch(
          `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}${subpathParam}`,
        )
          .then(res => {
            if (res.ok) return res.text();
            throw new Error();
          })
          .then(text => {
            setTextContent(truncateText(text));
          })
          .catch(() => setTextContent('Failed to load file content.'))
          .finally(() => setTextLoading(false));
      }
    }
  }, [files, folderKey, subpathParam, token, isOfflineFolder, offline]);

  const handleDelete = useCallback(async (filename: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?subpath=${encodeURIComponent(subpath)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Delete failed' }));
        setError(data.error || 'Delete failed');
        return;
      }
      setSelectedFiles(s => { const n = new Set(s); n.delete(filename); return n; });
      if (previewFile === filename) { closePreview(); }
      setConfirmDelete(null);
      fetchFiles();
    } catch {
      setError('Failed to delete file');
    } finally {
      setDeleting(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, previewFile, fetchFiles, closePreview]);

  const handleMove = useCallback(async (filename: string, targetFolder: string) => {
    setMoving(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/move`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFolder, sourceSubpath: subpath }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Move failed' }));
        setError(data.error || 'Move failed');
        return;
      }
      setSelectedFiles(s => { const n = new Set(s); n.delete(filename); return n; });
      if (previewFile === filename) { closePreview(); }
      setMoveTarget(null);
      fetchFiles();
    } catch {
      setError('Failed to move file');
    } finally {
      setMoving(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, previewFile, fetchFiles, closePreview]);

  const resetBreadcrumbActions = useCallback(() => {
    setRenamingBreadcrumb(false); setRenameBreadcrumbValue(''); setConfirmDeleteBreadcrumb(false);
  }, []);

  const handleNavigateInto = useCallback((dirName: string) => {
    setSubpath(prev => prev === '' ? dirName : `${prev}/${dirName}`);
    setPage(1);
    resetSelection();
    resetBreadcrumbActions();
  }, [resetSelection, resetBreadcrumbActions]);

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === -1) {
      setSubpath('');
    } else {
      const segments = subpath.split('/');
      setSubpath(segments.slice(0, index + 1).join('/'));
    }
    setPage(1);
    resetSelection();
    resetBreadcrumbActions();
  }, [subpath, resetSelection, resetBreadcrumbActions]);

  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return;
    setCreatingLoading(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/mkdir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, subpath }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Create failed' }));
        setError(data.error || 'Create failed');
        return;
      }
      setCreatingFolder(false);
      setNewFolderName('');
      fetchFiles();
    } catch {
      setError('Failed to create folder');
    } finally {
      setCreatingLoading(false);
    }
  }, [folderKey, newFolderName, subpath, authHeaders, onUnauthorized, fetchFiles]);

  const handleRenameDir = useCallback(async (oldName: string) => {
    const trimmed = renameDirValue.trim();
    if (!trimmed || trimmed === oldName) { setRenamingDir(null); return; }
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) { setRenamingDir(null); return; }
    setRenameDirLoading(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/rename-dir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath, oldName, newName: trimmed }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Rename failed' }));
        setError(data.error || 'Rename failed');
        return;
      }
      setRenamingDir(null);
      setRenameDirValue('');
      fetchFiles();
    } catch {
      setError('Failed to rename folder');
    } finally {
      setRenameDirLoading(false);
    }
  }, [folderKey, subpath, renameDirValue, authHeaders, onUnauthorized, fetchFiles]);

  const handleRenameFile = useCallback(async (oldName: string) => {
    const trimmed = renameFileValue.trim();
    if (!trimmed || trimmed === oldName) { setRenamingFile(null); return; }
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) { setRenamingFile(null); return; }
    setRenameFileLoading(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/rename-file`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath, oldName, newName: trimmed }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Rename failed' }));
        setError(data.error || 'Rename failed');
        return;
      }
      setRenamingFile(null);
      setRenameFileValue('');
      fetchFiles();
    } catch {
      setError('Failed to rename file');
    } finally {
      setRenameFileLoading(false);
    }
  }, [folderKey, subpath, renameFileValue, authHeaders, onUnauthorized, fetchFiles]);

  const handleDeleteDir = useCallback(async (dirName: string) => {
    setDeletingDir(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/rmdir`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath, name: dirName }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Delete failed' }));
        setError(data.error || 'Delete failed');
        return;
      }
      setConfirmDeleteDir(null);
      fetchFiles();
    } catch {
      setError('Failed to delete folder');
    } finally {
      setDeletingDir(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, fetchFiles]);

  // Breadcrumb: rename the current folder (last segment of subpath)
  const handleRenameBreadcrumb = useCallback(async () => {
    const trimmed = renameBreadcrumbValue.trim();
    const segments = subpath.split('/');
    const oldName = segments[segments.length - 1];
    if (!trimmed || trimmed === oldName) { setRenamingBreadcrumb(false); return; }
    const parentSubpath = segments.slice(0, -1).join('/');
    setRenameBreadcrumbLoading(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/rename-dir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath: parentSubpath, oldName, newName: trimmed }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Rename failed' }));
        setError(data.error || 'Rename failed');
        setRenamingBreadcrumb(false);
        setRenameBreadcrumbValue('');
        return;
      }
      // Update subpath to reflect the new name
      setSubpath([...segments.slice(0, -1), trimmed].join('/'));
      setRenamingBreadcrumb(false);
      setRenameBreadcrumbValue('');
      fetchFiles();
    } catch {
      setError('Failed to rename folder');
      setRenamingBreadcrumb(false);
      setRenameBreadcrumbValue('');
    } finally {
      setRenameBreadcrumbLoading(false);
    }
  }, [folderKey, subpath, renameBreadcrumbValue, authHeaders, onUnauthorized, fetchFiles]);

  // Breadcrumb: delete the current folder (last segment of subpath)
  const handleDeleteBreadcrumb = useCallback(async () => {
    const segments = subpath.split('/');
    const dirName = segments[segments.length - 1];
    const parentSubpath = segments.slice(0, -1).join('/');
    setDeletingBreadcrumb(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/rmdir`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath: parentSubpath, name: dirName }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Delete failed' }));
        setError(data.error || 'Delete failed');
        return;
      }
      // Navigate back to parent
      setSubpath(parentSubpath);
      setConfirmDeleteBreadcrumb(false);
      setPage(1);
      resetSelection();
    } catch {
      setError('Failed to delete folder');
    } finally {
      setDeletingBreadcrumb(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, resetSelection]);

  const currentDepth = subpath === '' ? 0 : subpath.split('/').length;

  const handleMoveToSubpath = useCallback(async (filenames: string[], targetDirName: string) => {
    let targetSubpath: string;
    if (targetDirName === '..') {
      const segments = subpath.split('/');
      targetSubpath = segments.slice(0, -1).join('/');
    } else {
      targetSubpath = subpath === '' ? targetDirName : `${subpath}/${targetDirName}`;
    }
    try {
      const results = await Promise.all(
        filenames.map(filename =>
          fetch(`/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/move-to-subpath`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceSubpath: subpath, targetSubpath }),
          }),
        ),
      );
      for (const res of results) {
        if (res.status === 401) { onUnauthorized(); return; }
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Move failed' }));
          setError(data.error || 'Move failed');
        }
      }
      // Clear moved files from selection
      setSelectedFiles(prev => {
        const next = new Set(prev);
        filenames.forEach(f => next.delete(f));
        return next;
      });
      if (previewFile && filenames.includes(previewFile)) {
        closePreview();
      }
      fetchFiles();
    } catch {
      setError('Failed to move file');
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, previewFile, fetchFiles, closePreview]);

  const getSelectedFiles = useCallback(() => Array.from(selectedFiles), [selectedFiles]);
  const drag = useDragToFolder(handleMoveToSubpath, getSelectedFiles);

  const pullRefresh = usePullToRefresh(fetchFiles, drag.isDraggingRef);

  const mediaType = previewFile ? getMediaType(previewFile) : null;

  // Build offline file list when viewing the offline pseudo-folder
  // Use the composite key (folderKey/subpath/name) as the display name to avoid collisions
  const offlineFileList = useMemo<BrowseFile[]>(() =>
    isOfflineFolder
      ? offline.offlineFiles.map((f: OfflineFileMeta) => ({ name: f.key, size: f.size, modifiedAt: f.savedAt }))
      : [],
    [isOfflineFolder, offline.offlineFiles]);
  const offlineFileMeta = useMemo<Map<string, OfflineFileMeta>>(() =>
    isOfflineFolder
      ? new Map(offline.offlineFiles.map(f => [f.key, f]))
      : new Map(),
    [isOfflineFolder, offline.offlineFiles]);

  const displayFiles = useMemo(() => {
    const base = isOfflineFolder ? offlineFileList : files;
    if (!isOfflineFolder) return base;
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'size') cmp = a.size - b.size;
      else cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [isOfflineFolder, offlineFileList, files, sortField, sortOrder]);
  const displayDirs = isOfflineFolder ? [] : dirs;
  const displayTotal = isOfflineFolder ? offlineFileList.length : total;
  const totalPages = Math.max(1, Math.ceil(displayTotal / limit));

  // Resolve preview URL: offline blob or server
  const previewSrc = useCallback(async (filename: string, type: 'file' | 'video'): Promise<string> => {
    if (isOfflineFolder) {
      const meta = offlineFileMeta.get(filename);
      if (meta) {
        const url = await offline.getOfflineUrl(meta.folderKey, meta.subpath, meta.name);
        if (url) return url;
      }
    }
    return type === 'video' ? videoSrc(filename) : fileUrl(filename);
  }, [isOfflineFolder, offlineFileMeta, offline, videoSrc, fileUrl]);

  // Load offline preview URL when preview changes
  useEffect(() => {
    if (!previewFile || !isOfflineFolder) {
      setOfflinePreviewUrl(null);
      return;
    }
    let cancelled = false;
    const mt = getMediaType(previewFile);
    previewSrc(previewFile, mt === 'video' ? 'video' : 'file').then(url => {
      if (!cancelled) setOfflinePreviewUrl(url);
    });
    return () => { cancelled = true; };
  }, [previewFile, isOfflineFolder, previewSrc]);

  const getPreviewUrl = (filename: string, type: 'file' | 'video'): string | null => {
    if (isOfflineFolder) return offlinePreviewUrl;
    return type === 'video' ? videoSrc(filename) : fileUrl(filename);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="browse" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6" ref={pullRefresh.containerRef}>
      <PullToRefreshIndicator pullDistance={pullRefresh.pullDistance} refreshing={pullRefresh.refreshing} />
      <div className="max-w-5xl mx-auto">
        <PageTitle icon={Folder} title="Browse Files" />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Left: folder selector + free space */}
          {(folders.length > 0 || isOfflineFolder) && (
            <div className="flex items-center gap-2 mr-auto">
              <select
                value={isOfflineFolder ? OFFLINE_FOLDER_KEY : folderKey}
                onChange={(e) => handleFolderChange(e.target.value)}
                className="min-w-[8rem] max-w-[16rem] px-4 py-2 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text text-sm"
                style={{ width: `${Math.max(...folders.map(f => f.length), 0, 11) + 4}ch` }}
              >
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="__offline__">offline ({offline.offlineFiles.length})</option>
              </select>
              {isOfflineFolder ? (
                <span className="px-2 py-0.5 rounded-full text-xs bg-th-bg-alt text-th-text-dim border border-th-border-lighter">
                  {formatBytes(offline.totalSize)} used
                </span>
              ) : freeSpace[folderKey] != null ? (
                <span className="px-2 py-0.5 rounded-full text-xs bg-th-bg-alt text-th-text-dim border border-th-border-lighter">
                  {formatBytes(freeSpace[folderKey])} free
                </span>
              ) : null}
            </div>
          )}
          {/* Right: actions — inline on sm+, "more" menu on mobile */}
          {/* Desktop inline actions */}
          <div className="hidden sm:flex items-center gap-3">
            {!isOfflineFolder && currentDepth < 2 && folderKey && (
              creatingFolder ? (
                <NewFolderForm
                  name={newFolderName}
                  onChange={setNewFolderName}
                  onConfirm={handleCreateFolder}
                  onCancel={() => { setCreatingFolder(false); setNewFolderName(''); }}
                  loading={creatingLoading}
                  inputClassName="w-36"
                />
              ) : (
                <button
                  onClick={() => setCreatingFolder(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-th-text-sub hover:text-th-text border border-th-border rounded-lg hover:bg-th-bg-alt transition"
                >
                  <FolderPlus className="w-4 h-4" />
                  New Folder
                </button>
              )
            )}
            {transcodingAvailable && (
              <label className="flex items-center gap-2 text-sm text-th-text-sub cursor-pointer select-none">
                <RefreshCw className="w-4 h-4" />
                <span>Transcode</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={transcoding}
                  onClick={() => setTranscoding(t => !t)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${transcoding ? 'bg-purple-500' : 'bg-th-border'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${transcoding ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </label>
            )}
          </div>
          {/* Mobile "more" menu */}
          {!isOfflineFolder && ((currentDepth < 2 && folderKey) || transcodingAvailable) && (
            <div className="relative sm:hidden" ref={moreMenuRef}>
              <button
                onClick={() => setMoreMenuOpen(o => !o)}
                className="p-2 rounded-lg text-th-text-sub hover:bg-th-bg-alt border border-th-border transition"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {moreMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-th-bg border border-th-border rounded-lg shadow-lg z-20 py-1 animate-scale-fade-in" style={{ transformOrigin: 'top right' }}>
                  {currentDepth < 2 && folderKey && (
                    <button
                      onClick={() => { setMoreMenuOpen(false); setCreatingFolder(true); }}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-th-text-sub hover:bg-th-bg-alt transition text-left"
                    >
                      <FolderPlus className="w-4 h-4" />
                      New Folder
                    </button>
                  )}
                  {transcodingAvailable && (
                    <label className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-th-text-sub hover:bg-th-bg-alt transition cursor-pointer">
                      <RefreshCw className="w-4 h-4" />
                      <span className="flex-1">Transcode</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={transcoding}
                        onClick={() => setTranscoding(t => !t)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${transcoding ? 'bg-purple-500' : 'bg-th-border'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${transcoding ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile: inline folder creation (shown below toolbar) */}
        {creatingFolder && (
          <NewFolderForm
            name={newFolderName}
            onChange={setNewFolderName}
            onConfirm={handleCreateFolder}
            onCancel={() => { setCreatingFolder(false); setNewFolderName(''); }}
            loading={creatingLoading}
            className="sm:hidden mb-4"
            inputClassName="flex-1 min-w-0"
          />
        )}

        {/* Breadcrumbs */}
        {!isOfflineFolder && subpath !== '' && (
          <div className="flex items-center gap-1 mb-4 text-sm flex-wrap">
            <button
              onClick={() => handleBreadcrumbClick(-1)}
              className="text-purple-500 hover:text-purple-400 transition font-medium"
            >
              {folderKey}
            </button>
            {subpath.split('/').map((segment, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="w-4 h-4 text-th-text-faint" />
                {i === arr.length - 1 ? (
                  renamingBreadcrumb ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={renameBreadcrumbValue}
                        onChange={(e) => setRenameBreadcrumbValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameBreadcrumb();
                          if (e.key === 'Escape') { setRenamingBreadcrumb(false); setRenameBreadcrumbValue(''); }
                        }}
                        disabled={renameBreadcrumbLoading}
                        className="px-2 py-0.5 text-sm border border-th-border rounded bg-th-bg text-th-text outline-none focus:ring-2 focus:ring-th-ring min-w-0"
                      />
                      <button
                        onClick={() => handleRenameBreadcrumb()}
                        disabled={renameBreadcrumbLoading || !renameBreadcrumbValue.trim()}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/15 text-purple-600 hover:bg-purple-500/25 transition disabled:opacity-50"
                      >
                        {renameBreadcrumbLoading ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setRenamingBreadcrumb(false); setRenameBreadcrumbValue(''); }}
                        className="px-2 py-0.5 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : confirmDeleteBreadcrumb ? (
                    <span className="flex items-center gap-1">
                      <span className="text-th-text font-medium">{segment}</span>
                      <button
                        onClick={() => handleDeleteBreadcrumb()}
                        disabled={deletingBreadcrumb}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-600 hover:bg-red-500/25 transition disabled:opacity-50"
                      >
                        {deletingBreadcrumb ? 'Deleting…' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteBreadcrumb(false)}
                        className="px-2 py-0.5 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="text-th-text font-medium">{segment}</span>
                      <button
                        onClick={() => { setRenamingBreadcrumb(true); setRenameBreadcrumbValue(segment); setConfirmDeleteBreadcrumb(false); }}
                        className="p-1 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition"
                        title="Rename folder"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteBreadcrumb(true); setRenamingBreadcrumb(false); }}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-500/15 transition"
                        title="Delete folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )
                ) : (
                  <button
                    onClick={() => handleBreadcrumbClick(i)}
                    className="text-purple-500 hover:text-purple-400 transition font-medium"
                  >
                    {segment}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}
        {offline.saveError && (
          <div className="p-4 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600 flex items-center justify-between">
            <span>Failed to save offline: {offline.saveError}</span>
            <button onClick={offline.clearSaveError} className="text-red-400 hover:text-red-600 ml-2 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Media viewer */}
        {previewFile && (
          <div className="mb-4 bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-hidden animate-fade-in">
            <div className="flex items-start justify-between px-4 py-2 bg-th-bg-alt border-b border-th-border-light">
              <span className="text-sm font-medium text-th-text-sub break-all">{previewFile}</span>
              <button onClick={closePreview} className="text-th-text-faint hover:text-th-text-sub transition ml-2 mt-0.5 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            {mediaType === 'text' ? (
              <div className="max-h-[70vh] overflow-auto bg-th-bg-alt">
                {textLoading ? (
                  <div className="p-6 text-center text-th-text-faint text-sm">Loading...</div>
                ) : (
                  <pre className="p-4 text-sm text-th-text-sub font-mono whitespace-pre-wrap break-all">{textContent}</pre>
                )}
              </div>
            ) : mediaType ? (
              <div className="flex items-center justify-center p-4 bg-th-bg-media min-h-[200px]">
                {(() => {
                  const src = getPreviewUrl(previewFile, mediaType === 'video' ? 'video' : 'file');
                  if (!src) return <Loader2 className="w-6 h-6 animate-spin text-th-text-faint" />;
                  return (
                    <>
                      {mediaType === 'video' && (
                        videoError ? (
                          <div className="text-red-500 text-sm text-center p-4">
                            <p>Failed to load video{transcoding ? ' (transcoding may have failed)' : ''}.</p>
                            <button
                              className="mt-2 text-th-accent hover:underline"
                              onClick={() => { setVideoError(false); setVideoRetryKey(k => k + 1); }}
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <video
                            key={`${previewFile}-${videoRetryKey}`}
                            src={src}
                            controls
                            playsInline
                            className="max-w-full max-h-[70vh]"
                            onError={() => setVideoError(true)}
                          />
                        )
                      )}
                      {mediaType === 'audio' && (
                        <audio key={previewFile} src={src} controls className="w-full max-w-lg" />
                      )}
                      {mediaType === 'image' && (
                        <img key={previewFile} src={src} alt={previewFile} className="max-w-full max-h-[70vh] object-contain" />
                      )}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>
        )}

        {/* File list */}
        {loading && !isOfflineFolder ? (
          <div className="py-20 text-center text-th-text-faint text-sm">Loading...</div>
        ) : displayFiles.length === 0 && displayDirs.length === 0 && !subpath ? (
          <div className="py-20 text-center text-th-text-faint text-sm">
            {isOfflineFolder ? (
              <div className="flex flex-col items-center gap-2">
                <WifiOff className="w-8 h-8 text-th-text-faint" />
                <p>No offline files saved yet.</p>
                <p className="text-xs">Browse a folder and tap <CloudDownload className="w-3.5 h-3.5 inline" /> to save files for offline playback.</p>
              </div>
            ) : 'No files in this folder.'}
          </div>
        ) : (
          <div className="bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-hidden animate-fade-in">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th-border-lighter bg-th-bg-alt text-left text-xs font-medium text-th-text-dim uppercase tracking-wide">
                  <th className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleSort('name')}
                        className="hidden sm:flex items-center gap-1 hover:text-th-text transition"
                      >
                        Name
                        <SortIcon active={sortField === 'name'} order={sortOrder} />
                      </button>
                      <MobileSortMenu sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                    </div>
                  </th>
                  <th className="px-4 py-3 w-28 hidden sm:table-cell">
                    <button
                      onClick={() => handleSort('size')}
                      className="flex items-center gap-1 hover:text-th-text transition"
                    >
                      Size
                      <SortIcon active={sortField === 'size'} order={sortOrder} />
                    </button>
                  </th>
                  <th className="px-4 py-3 w-44 hidden md:table-cell">
                    <button
                      onClick={() => handleSort('modified')}
                      className="flex items-center gap-1 hover:text-th-text transition"
                    >
                      {isOfflineFolder ? 'Source' : 'Modified'}
                      <SortIcon active={sortField === 'modified'} order={sortOrder} />
                    </button>
                  </th>
                  <th className="px-4 py-3 w-32 hidden sm:table-cell"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-border-lighter">
                {/* Back row */}
                {!isOfflineFolder && subpath !== '' && (
                  <tr
                    className="hover:bg-th-bg-alt transition cursor-pointer"
                    onClick={() => handleBreadcrumbClick(subpath.split('/').length - 2)}
                    {...drag.backRow()}
                  >
                    <td className="px-4 py-3 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0"><Folder className="w-4 h-4 text-amber-500" /></span>
                        <span className="font-medium text-th-text-sub">..</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-text-dim hidden sm:table-cell">&mdash;</td>
                    <td className="px-4 py-3 text-th-text-dim hidden md:table-cell">&mdash;</td>
                    <td className="px-4 py-3 hidden sm:table-cell"></td>
                  </tr>
                )}
                {/* Directory rows */}
                {displayDirs.map((dirName) => (
                  <tr
                    key={`dir-${dirName}`}
                    className="hover:bg-th-bg-alt transition cursor-pointer"
                    onClick={() => { if (!renamingDir && !confirmDeleteDir) handleNavigateInto(dirName); }}
                    {...drag.dirRow(dirName)}
                  >
                    <td className="px-4 py-3 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0"><Folder className="w-4 h-4 text-amber-500" /></span>
                        {renamingDir === dirName ? (
                          <input
                            type="text"
                            autoFocus
                            value={renameDirValue}
                            onChange={(e) => setRenameDirValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameDir(dirName);
                              if (e.key === 'Escape') { setRenamingDir(null); setRenameDirValue(''); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            disabled={renameDirLoading}
                            className="px-2 py-0.5 text-sm border border-th-border rounded bg-th-bg text-th-text outline-none focus:ring-2 focus:ring-th-ring min-w-0 flex-1"
                          />
                        ) : (
                          <span className="font-medium text-th-text-sub">{dirName}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-text-dim hidden sm:table-cell">&mdash;</td>
                    <td className="px-4 py-3 text-th-text-dim hidden md:table-cell">&mdash;</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {confirmDeleteDir === dirName ? (
                          <>
                            <button
                              onClick={() => handleDeleteDir(dirName)}
                              disabled={deletingDir}
                              className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-600 hover:bg-red-500/25 transition disabled:opacity-50"
                            >
                              {deletingDir ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteDir(null)}
                              className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                            >
                              Cancel
                            </button>
                          </>
                        ) : renamingDir === dirName ? (
                          <>
                            <button
                              onClick={() => handleRenameDir(dirName)}
                              disabled={renameDirLoading || !renameDirValue.trim()}
                              className="px-2 py-1 rounded text-xs font-medium bg-purple-500/15 text-purple-600 hover:bg-purple-500/25 transition disabled:opacity-50"
                            >
                              {renameDirLoading ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => { setRenamingDir(null); setRenameDirValue(''); }}
                              className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setRenamingDir(dirName); setRenameDirValue(dirName); setConfirmDeleteDir(null); }}
                              className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition"
                              title="Rename folder"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setConfirmDeleteDir(dirName); setRenamingDir(null); }}
                              className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-500/15 transition"
                              title="Delete folder"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {displayFiles.map((file, fileIndex) => {
                  const isSelected = selectedFiles.has(file.name);
                  const showExpanded = isSelected && selectedFiles.size === 1;
                  const offMeta = isOfflineFolder ? offlineFileMeta.get(file.name) : undefined;
                  const displayName = offMeta?.name ?? file.name;
                  const fileIsOffline = isOfflineFolder || offline.isOffline(folderKey, subpath, file.name);
                  const fileIsSaving = offline.isSaving(folderKey, subpath, file.name);
                  return (
                    <Fragment key={file.name}>
                      <tr
                        className={`hover:bg-th-bg-alt transition cursor-pointer ${isSelected ? 'bg-th-bg-muted' : ''} ${moving && moveTarget === file.name ? 'opacity-60' : ''}`}
                        onClick={(e) => { if (!renamingFile) handleFileClick(file.name, fileIndex, e); }}
                        {...(isOfflineFolder ? {} : drag.fileRow(file.name))}
                      >
                        <td className="px-4 py-4 sm:py-3 max-w-0 min-w-[150px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0 relative">
                              {file.has_thumbnail && !isOfflineFolder ? (
                                <img
                                  src={thumbUrl(file.name)}
                                  alt=""
                                  width={40}
                                  height={40}
                                  className="rounded object-cover"
                                  style={{ width: 40, height: 40 }}
                                />
                              ) : (
                                <MediaIcon filename={displayName} />
                              )}
                              {fileIsOffline && !isOfflineFolder && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500" title="Saved offline" />
                              )}
                            </span>
                            <div className="min-w-0">
                              {renamingFile === file.name ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameFileValue}
                                  onChange={(e) => setRenameFileValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameFile(file.name);
                                    if (e.key === 'Escape') { setRenamingFile(null); setRenameFileValue(''); }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={renameFileLoading}
                                  className="px-2 py-0.5 text-sm border border-th-border rounded bg-th-bg text-th-text outline-none focus:ring-2 focus:ring-th-ring min-w-0 w-full"
                                />
                              ) : (
                                <span className="font-medium text-th-text-sub truncate block" title={displayName}>{displayName}</span>
                              )}
                              <span className="text-xs text-th-text-faint sm:hidden">
                                {formatBytes(file.size)}
                                {offMeta && (
                                  <span className="ml-1 text-th-text-faint">· {offMeta.folderKey}</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-th-text-dim whitespace-nowrap hidden sm:table-cell">{formatBytes(file.size)}</td>
                        <td className="px-4 py-3 text-th-text-dim whitespace-nowrap hidden md:table-cell">
                          {offMeta
                            ? <span title={formatDate(file.modifiedAt)}>{offMeta.folderKey}{offMeta.subpath ? `/${offMeta.subpath}` : ''}</span>
                            : formatDate(file.modifiedAt)}
                        </td>
                        {/* Desktop action buttons */}
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            {confirmDelete === file.name ? (
                              <>
                                <button onClick={() => handleDelete(file.name)} disabled={deleting} className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-600 hover:bg-red-500/25 transition disabled:opacity-50">
                                  {deleting ? 'Deleting…' : 'Delete'}
                                </button>
                                <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition">Cancel</button>
                              </>
                            ) : moveTarget === file.name ? (
                              moving ? (
                                <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-th-text-dim"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Moving…</span>
                              ) : (
                                <>
                                  <select autoFocus defaultValue="" onChange={(e) => { if (e.target.value) handleMove(file.name, e.target.value); }} className="pl-2 pr-4 py-1 rounded text-xs border border-th-border bg-th-bg text-th-text outline-none">
                                    <option value="" disabled>Move to…</option>
                                    {folders.filter(f => f !== folderKey).map(f => (<option key={f} value={f}>{f}</option>))}
                                  </select>
                                  <button onClick={() => setMoveTarget(null)} className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition">Cancel</button>
                                </>
                              )
                            ) : renamingFile === file.name ? (
                              <>
                                <button
                                  onClick={() => handleRenameFile(file.name)}
                                  disabled={renameFileLoading || !renameFileValue.trim()}
                                  className="px-2 py-1 rounded text-xs font-medium bg-purple-500/15 text-purple-600 hover:bg-purple-500/25 transition disabled:opacity-50"
                                >
                                  {renameFileLoading ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={() => { setRenamingFile(null); setRenameFileValue(''); }}
                                  className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                {isOfflineFolder ? (
                                  <>
                                    {(offMeta?.mediaType === 'audio' || offMeta?.mediaType === 'video') && (
                                      <>
                                        <button
                                          onClick={async () => { if (!offMeta) return; const item = await makeOfflineQueueItem(offMeta); if (item) playNow(item); }}
                                          className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition"
                                          title="Play now"
                                        ><Play className="w-4 h-4" /></button>
                                        <button
                                          onClick={async () => { if (!offMeta) return; const item = await makeOfflineQueueItem(offMeta); if (item) addToQueue(item); }}
                                          className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition"
                                          title="Add to queue"
                                        ><ListPlus className="w-4 h-4" /></button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => offMeta && offline.removeOffline(offMeta.folderKey, offMeta.subpath, offMeta.name)}
                                      className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-500/15 transition"
                                      title="Remove from offline"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {getMediaType(file.name) === 'audio' && (
                                      <>
                                        <button onClick={() => { const item = makeQueueItem(file); if (item) playNow(item); }} className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition" title="Play now"><Play className="w-4 h-4" /></button>
                                        <button onClick={() => { const item = makeQueueItem(file); if (item) addToQueue(item); }} className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition" title="Add to queue"><ListPlus className="w-4 h-4" /></button>
                                      </>
                                    )}
                                    <a href={fileUrl(file.name)} download={file.name} className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub transition" title="Download"><Download className="w-4 h-4" /></a>
                                    <OfflineButton compact isSaving={fileIsSaving} isOffline={fileIsOffline}
                                      onSave={() => offline.saveOffline(fileUrl(file.name), folderKey, subpath, file.name, getMediaType(file.name)).catch(() => {})}
                                      onRemove={() => offline.removeOffline(folderKey, subpath, file.name)}
                                    />
                                    {folders.length > 1 && (
                                      <button onClick={() => { setMoveTarget(file.name); setConfirmDelete(null); setRenamingFile(null); }} className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition" title="Move to another folder"><ArrowRightLeft className="w-4 h-4" /></button>
                                    )}
                                    <button onClick={() => { setRenamingFile(file.name); setRenameFileValue(file.name); setConfirmDelete(null); setMoveTarget(null); }} className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition" title="Rename file"><Pencil className="w-4 h-4" /></button>
                                    <button onClick={() => { setConfirmDelete(file.name); setMoveTarget(null); setRenamingFile(null); }} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-500/15 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Mobile expanded actions — visible when file is selected */}
                      {showExpanded && (
                        <tr className="sm:hidden bg-th-bg-muted/50" onClick={(e) => e.stopPropagation()}>
                          <td colSpan={4} className="px-4 py-2">
                            {confirmDelete === file.name ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-th-text-dim mr-auto">Delete this file?</span>
                                <button onClick={() => handleDelete(file.name)} disabled={deleting} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white transition disabled:opacity-50">
                                  {deleting ? 'Deleting…' : 'Delete'}
                                </button>
                                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-dim hover:text-th-text bg-th-bg border border-th-border-light transition">Cancel</button>
                              </div>
                            ) : moveTarget === file.name ? (
                              moving ? (
                                <span className="flex items-center gap-1.5 text-xs text-th-text-dim"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Moving…</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <select autoFocus defaultValue="" onChange={(e) => { if (e.target.value) handleMove(file.name, e.target.value); }} className="flex-1 pl-3 pr-6 py-1.5 rounded-lg text-xs border border-th-border bg-th-bg text-th-text outline-none">
                                    <option value="" disabled>Move to…</option>
                                    {folders.filter(f => f !== folderKey).map(f => (<option key={f} value={f}>{f}</option>))}
                                  </select>
                                  <button onClick={() => setMoveTarget(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-dim hover:text-th-text bg-th-bg border border-th-border-light transition">Cancel</button>
                                </div>
                              )
                            ) : renamingFile === file.name ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameFileValue}
                                  onChange={(e) => setRenameFileValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameFile(file.name);
                                    if (e.key === 'Escape') { setRenamingFile(null); setRenameFileValue(''); }
                                  }}
                                  disabled={renameFileLoading}
                                  className="flex-1 px-3 py-1.5 rounded-lg text-xs border border-th-border bg-th-bg text-th-text outline-none focus:ring-2 focus:ring-th-ring"
                                />
                                <button onClick={() => handleRenameFile(file.name)} disabled={renameFileLoading || !renameFileValue.trim()} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-600 hover:bg-purple-500/25 transition disabled:opacity-50">
                                  {renameFileLoading ? 'Saving…' : 'Save'}
                                </button>
                                <button onClick={() => { setRenamingFile(null); setRenameFileValue(''); }} className="px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-dim hover:text-th-text bg-th-bg border border-th-border-light transition">Cancel</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                {isOfflineFolder ? (
                                  <>
                                    {(offMeta?.mediaType === 'audio' || offMeta?.mediaType === 'video') && (
                                      <>
                                        <button
                                          onClick={async () => { if (!offMeta) return; const item = await makeOfflineQueueItem(offMeta); if (item) playNow(item); }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition"
                                        ><Play className="w-3.5 h-3.5" />Play</button>
                                        <button
                                          onClick={async () => { if (!offMeta) return; const item = await makeOfflineQueueItem(offMeta); if (item) addToQueue(item); }}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition"
                                        ><ListPlus className="w-3.5 h-3.5" />Add to Queue</button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => offMeta && offline.removeOffline(offMeta.folderKey, offMeta.subpath, offMeta.name)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-th-bg border border-red-500/20 transition"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />Remove Offline
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {getMediaType(file.name) === 'audio' && (
                                      <>
                                        <button onClick={() => { const item = makeQueueItem(file); if (item) playNow(item); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition">
                                          <Play className="w-3.5 h-3.5" />Play
                                        </button>
                                        <button onClick={() => { const item = makeQueueItem(file); if (item) addToQueue(item); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition">
                                          <ListPlus className="w-3.5 h-3.5" />Add to Queue
                                        </button>
                                      </>
                                    )}
                                    <a href={fileUrl(file.name)} download={file.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition">
                                      <Download className="w-3.5 h-3.5" />Download
                                    </a>
                                    <OfflineButton isSaving={fileIsSaving} isOffline={fileIsOffline}
                                      onSave={() => offline.saveOffline(fileUrl(file.name), folderKey, subpath, file.name, getMediaType(file.name)).catch(() => {})}
                                      onRemove={() => offline.removeOffline(folderKey, subpath, file.name)}
                                    />
                                    {folders.length > 1 && (
                                      <button onClick={() => { setMoveTarget(file.name); setConfirmDelete(null); setRenamingFile(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition">
                                        <ArrowRightLeft className="w-3.5 h-3.5" />Move
                                      </button>
                                    )}
                                    <button onClick={() => { setRenamingFile(file.name); setRenameFileValue(file.name); setConfirmDelete(null); setMoveTarget(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-th-text-sub bg-th-bg border border-th-border-light transition">
                                      <Pencil className="w-3.5 h-3.5" />Rename
                                    </button>
                                    <button onClick={() => { setConfirmDelete(file.name); setMoveTarget(null); setRenamingFile(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-th-bg border border-red-500/20 transition ml-auto">
                                      <Trash2 className="w-3.5 h-3.5" />Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm text-th-text bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-th-text-dim">
              Page {page} of {totalPages} ({displayTotal} files)
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm text-th-text bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

