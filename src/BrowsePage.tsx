import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthHeaders } from './useAuthHeaders';
import { Folder, Film, Music, Image, FileText, FileCode, Download, X, ChevronLeft, ChevronRight, Trash2, RefreshCw, ArrowRightLeft, FolderPlus, MoreVertical } from 'lucide-react';
import { formatBytes, formatDate, getMediaType } from './utils';
import NavBar from './NavBar';
import { useDragToFolder } from './useDragToFolder';

interface BrowseFile {
  name: string;
  size: number;
  modifiedAt: string;
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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null); // filename being moved
  const [moving, setMoving] = useState(false);
  const [subpath, setSubpath] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingLoading, setCreatingLoading] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close "more" dropdown on outside click
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreMenuOpen]);

  const authHeaders = useAuthHeaders(token);

  useEffect(() => {
    fetch('/api/config', { headers: authHeaders })
      .then(res => {
        if (res.status === 401) { onUnauthorized(); return null; }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        setFolders(data.folders);
        if (data.freeSpace) setFreeSpace(data.freeSpace);
        if (data.folders.length > 0) setFolderKey(data.folders[0]);
        const tc = data.transcoding ?? false;
        setTranscodingAvailable(tc);
        setTranscoding(tc);
      })
      .catch(() => setError('Could not load configuration'));
  }, [authHeaders, onUnauthorized]);

  const fetchFiles = useCallback(async () => {
    if (!folderKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}?page=${page}&limit=${limit}&subpath=${encodeURIComponent(subpath)}`, {
        headers: authHeaders,
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setFiles(data.files);
      setTotal(data.total);
      setDirs((data.dirs || []).map((d: { name: string }) => d.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [folderKey, page, limit, subpath, authHeaders, onUnauthorized]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const subpathParam = subpath ? `&subpath=${encodeURIComponent(subpath)}` : '';

  const fileUrl = (filename: string) =>
    `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}${subpathParam}`;

  const videoSrc = (filename: string) =>
    transcoding
      ? `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/stream?token=${encodeURIComponent(token)}${subpathParam}`
      : fileUrl(filename);

  const handleFolderChange = (key: string) => {
    setFolderKey(key);
    setSubpath('');
    setPage(1);
    setSelectedFile(null);
    setTextContent(null);
  };

  const handleSelectFile = useCallback(async (filename: string) => {
    setSelectedFile(filename);
    setTextContent(null);
    const type = getMediaType(filename);
    if (type === 'text') {
      setTextLoading(true);
      try {
        const res = await fetch(
          `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}${subpathParam}`,
        );
        if (res.ok) {
          const text = await res.text();
          // Cap preview at 500KB to avoid freezing the browser
          setTextContent(text.length > 512_000 ? text.slice(0, 512_000) + '\n\n… (truncated)' : text);
        } else {
          setTextContent('Failed to load file content.');
        }
      } catch {
        setTextContent('Failed to load file content.');
      } finally {
        setTextLoading(false);
      }
    }
  }, [folderKey, subpathParam, token]);

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
      if (selectedFile === filename) {
        setSelectedFile(null);
        setTextContent(null);
      }
      setConfirmDelete(null);
      fetchFiles();
    } catch {
      setError('Failed to delete file');
    } finally {
      setDeleting(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, selectedFile, fetchFiles]);

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
      if (selectedFile === filename) {
        setSelectedFile(null);
        setTextContent(null);
      }
      setMoveTarget(null);
      fetchFiles();
    } catch {
      setError('Failed to move file');
    } finally {
      setMoving(false);
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, selectedFile, fetchFiles]);

  const handleNavigateInto = useCallback((dirName: string) => {
    setSubpath(prev => prev === '' ? dirName : `${prev}/${dirName}`);
    setPage(1);
    setSelectedFile(null);
    setTextContent(null);
  }, []);

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === -1) {
      setSubpath('');
    } else {
      const segments = subpath.split('/');
      setSubpath(segments.slice(0, index + 1).join('/'));
    }
    setPage(1);
    setSelectedFile(null);
    setTextContent(null);
  }, [subpath]);

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

  const currentDepth = subpath === '' ? 0 : subpath.split('/').length;

  const handleMoveToSubpath = useCallback(async (filename: string, targetDirName: string) => {
    let targetSubpath: string;
    if (targetDirName === '..') {
      // Move to parent
      const segments = subpath.split('/');
      targetSubpath = segments.slice(0, -1).join('/');
    } else {
      targetSubpath = subpath === '' ? targetDirName : `${subpath}/${targetDirName}`;
    }
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/move-to-subpath`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceSubpath: subpath, targetSubpath }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Move failed' }));
        setError(data.error || 'Move failed');
        return;
      }
      if (selectedFile === filename) {
        setSelectedFile(null);
        setTextContent(null);
      }
      fetchFiles();
    } catch {
      setError('Failed to move file');
    }
  }, [folderKey, subpath, authHeaders, onUnauthorized, selectedFile, fetchFiles]);

  const drag = useDragToFolder(handleMoveToSubpath);

  const mediaType = selectedFile ? getMediaType(selectedFile) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="browse" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Page title */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Folder className="w-6 h-6 shrink-0 text-th-text-sub" />
          <h1 className="text-xl sm:text-2xl font-semibold text-th-text">Browse Files</h1>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Left: folder selector + free space */}
          {folders.length > 0 && (
            <div className="flex items-center gap-2 mr-auto">
              <select
                value={folderKey}
                onChange={(e) => handleFolderChange(e.target.value)}
                className="min-w-[8rem] max-w-[16rem] px-4 py-2 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text text-sm"
                style={{ width: `${Math.max(...folders.map(f => f.length), 4) + 4}ch` }}
              >
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              {freeSpace[folderKey] != null && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-th-bg-alt text-th-text-dim border border-th-border-lighter">
                  {formatBytes(freeSpace[folderKey])} free
                </span>
              )}
            </div>
          )}
          {/* Right: actions — inline on sm+, "more" menu on mobile */}
          {/* Desktop inline actions */}
          <div className="hidden sm:flex items-center gap-3">
            {currentDepth < 2 && folderKey && (
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
          {((currentDepth < 2 && folderKey) || transcodingAvailable) && (
            <div className="relative sm:hidden" ref={moreMenuRef}>
              <button
                onClick={() => setMoreMenuOpen(o => !o)}
                className="p-2 rounded-lg text-th-text-sub hover:bg-th-bg-alt border border-th-border transition"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {moreMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-th-bg border border-th-border rounded-lg shadow-lg z-20 py-1">
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
        {subpath !== '' && (
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
                  <span className="text-th-text font-medium">{segment}</span>
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

        {/* Media viewer */}
        {selectedFile && (
          <div className="mb-4 bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-th-bg-alt border-b border-th-border-light">
              <span className="text-sm font-medium text-th-text-sub truncate">{selectedFile}</span>
              <button onClick={() => { setSelectedFile(null); setTextContent(null); }} className="text-th-text-faint hover:text-th-text-sub transition">
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
            ) : (
              <div className="flex items-center justify-center p-4 bg-th-bg-media min-h-[200px]">
                {mediaType === 'video' && (
                  <video
                    key={selectedFile}
                    src={videoSrc(selectedFile)}
                    controls
                    playsInline
                    className="max-w-full max-h-[70vh]"
                  />
                )}
                {mediaType === 'audio' && (
                  <audio
                    key={selectedFile}
                    src={fileUrl(selectedFile)}
                    controls
                    className="w-full max-w-lg"
                  />
                )}
                {mediaType === 'image' && (
                  <img
                    key={selectedFile}
                    src={fileUrl(selectedFile)}
                    alt={selectedFile}
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* File list */}
        {loading ? (
          <div className="py-20 text-center text-th-text-faint text-sm">Loading...</div>
        ) : files.length === 0 && dirs.length === 0 && !subpath ? (
          <div className="py-20 text-center text-th-text-faint text-sm">No files in this folder.</div>
        ) : (
          <div className="bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th-border-lighter bg-th-bg-alt text-left text-xs font-medium text-th-text-dim uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 w-28">Size</th>
                  <th className="px-4 py-3 w-44">Modified</th>
                  <th className="px-4 py-3 w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-border-lighter">
                {/* Back row */}
                {subpath !== '' && (
                  <tr
                    className="hover:bg-th-bg-alt transition cursor-pointer"
                    onClick={() => handleBreadcrumbClick(subpath.split('/').length - 2)}
                    {...drag.backRow()}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0"><Folder className="w-4 h-4 text-amber-500" /></span>
                        <span className="font-medium text-th-text-sub">..</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-text-dim">&mdash;</td>
                    <td className="px-4 py-3 text-th-text-dim">&mdash;</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                )}
                {/* Directory rows */}
                {dirs.map((dirName) => (
                  <tr
                    key={`dir-${dirName}`}
                    className="hover:bg-th-bg-alt transition cursor-pointer"
                    onClick={() => handleNavigateInto(dirName)}
                    {...drag.dirRow(dirName)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0"><Folder className="w-4 h-4 text-amber-500" /></span>
                        <span className="font-medium text-th-text-sub">{dirName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-text-dim">&mdash;</td>
                    <td className="px-4 py-3 text-th-text-dim">&mdash;</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                ))}
                {files.map((file) => {
                  const type = getMediaType(file.name);
                  return (
                    <tr
                      key={file.name}
                      className={`hover:bg-th-bg-alt transition ${type ? 'cursor-pointer' : ''} ${selectedFile === file.name ? 'bg-th-bg-muted' : ''} ${moving && moveTarget === file.name ? 'opacity-60' : ''}`}
                      onClick={() => { if (type) handleSelectFile(file.name); }}
                      {...drag.fileRow(file.name)}
                    >
                      <td className="px-4 py-3 max-w-0 min-w-[150px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="shrink-0"><MediaIcon filename={file.name} /></span>
                          <span className="font-medium text-th-text-sub truncate" title={file.name}>{file.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-th-text-dim whitespace-nowrap">{formatBytes(file.size)}</td>
                      <td className="px-4 py-3 text-th-text-dim whitespace-nowrap">{formatDate(file.modifiedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {confirmDelete === file.name ? (
                            <>
                              <button
                                onClick={() => handleDelete(file.name)}
                                disabled={deleting}
                                className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-600 hover:bg-red-500/25 transition disabled:opacity-50"
                              >
                                {deleting ? 'Deleting…' : 'Delete'}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                              >
                                Cancel
                              </button>
                            </>
                          ) : moveTarget === file.name ? (
                            moving ? (
                              <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-th-text-dim">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Moving…
                              </span>
                            ) : (
                            <>
                              <select
                                autoFocus
                                defaultValue=""
                                onChange={(e) => { if (e.target.value) handleMove(file.name, e.target.value); }}
                                className="pl-2 pr-4 py-1 rounded text-xs border border-th-border bg-th-bg text-th-text outline-none"
                              >
                                <option value="" disabled>Move to…</option>
                                {folders.filter(f => f !== folderKey).map(f => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => setMoveTarget(null)}
                                className="px-2 py-1 rounded text-xs font-medium text-th-text-dim hover:text-th-text transition"
                              >
                                Cancel
                              </button>
                            </>
                            )
                          ) : (
                            <>
                              <a
                                href={fileUrl(file.name)}
                                download={file.name}
                                className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub transition"
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                              {folders.length > 1 && (
                                <button
                                  onClick={() => { setMoveTarget(file.name); setConfirmDelete(null); }}
                                  className="p-1.5 rounded text-th-text-faint hover:text-th-text-sub hover:bg-th-bg-alt transition"
                                  title="Move to another folder"
                                >
                                  <ArrowRightLeft className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => { setConfirmDelete(file.name); setMoveTarget(null); }}
                                className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-500/15 transition"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
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
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-th-text bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-th-text-dim">
              Page {page} of {totalPages} ({total} files)
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-th-text bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
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
