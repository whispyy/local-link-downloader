import { useState, useEffect, useCallback } from 'react';
import { Folder, Film, Music, Image, FileText, FileCode, Download, X, ChevronLeft, ChevronRight, Trash2, RefreshCw, HardDrive } from 'lucide-react';
import { formatBytes, getMediaType } from './utils';
import SettingsMenu from './SettingsMenu';

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function BrowsePage({ token, onUnauthorized, authEnabled }: BrowsePageProps) {
  const [folders, setFolders] = useState<string[]>([]);
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

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch('/api/config', { headers: authHeaders })
      .then(res => {
        if (res.status === 401) { onUnauthorized(); return null; }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        setFolders(data.folders);
        if (data.folders.length > 0) setFolderKey(data.folders[0]);
        const tc = data.transcoding ?? false;
        setTranscodingAvailable(tc);
        setTranscoding(tc);
      })
      .catch(() => setError('Could not load configuration'));
  }, []);

  const fetchFiles = useCallback(async () => {
    if (!folderKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}?page=${page}&limit=${limit}`, {
        headers: authHeaders,
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setFiles(data.files);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [folderKey, page, limit, token]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fileUrl = (filename: string) =>
    `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;

  const videoSrc = (filename: string) =>
    transcoding
      ? `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}/stream?token=${encodeURIComponent(token)}`
      : fileUrl(filename);

  const handleFolderChange = (key: string) => {
    setFolderKey(key);
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
          `/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`,
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
  }, [folderKey, token]);

  const handleDelete = useCallback(async (filename: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/browse/${encodeURIComponent(folderKey)}/${encodeURIComponent(filename)}`, {
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
  }, [folderKey, token, selectedFile, fetchFiles]);

  const mediaType = selectedFile ? getMediaType(selectedFile) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      {/* Sticky nav bar */}
      <header className="sticky top-0 z-50 bg-th-bg/80 backdrop-blur-md border-b border-th-border-light pwa-safe-top">
        <div className="max-w-5xl mx-auto flex items-center justify-between h-12 px-4 sm:px-6">
          <a href="#" className="text-th-text-dim hover:text-th-text transition" title="File Manager"><HardDrive className="w-5 h-5 sm:hidden" /><span className="hidden sm:inline text-sm font-medium">File Manager</span></a>
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1 text-sm">
              <a href="#" className="px-2 py-1 rounded text-th-text-dim hover:text-th-text transition">Download</a>
              <a href="#/browse" className="px-2 py-1 rounded bg-th-bg-muted text-th-text font-medium">Browse</a>
              <a href="#/queue" className="px-2 py-1 rounded text-th-text-dim hover:text-th-text transition">Queue</a>
            </nav>
            <SettingsMenu authEnabled={authEnabled} onSignOut={onUnauthorized} />
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Page title */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Folder className="w-6 h-6 shrink-0 text-th-text-sub" />
          <h1 className="text-xl sm:text-2xl font-semibold text-th-text">Browse Files</h1>
        </div>

        {/* Folder selector + transcoding toggle */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          {folders.length > 0 && (
            <select
              value={folderKey}
              onChange={(e) => handleFolderChange(e.target.value)}
              className="px-4 py-2 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text text-sm"
            >
              {folders.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
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

        {/* Error */}
        {error && (
          <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
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
        ) : files.length === 0 ? (
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
                {files.map((file) => {
                  const type = getMediaType(file.name);
                  return (
                    <tr
                      key={file.name}
                      className={`hover:bg-th-bg-alt transition ${type ? 'cursor-pointer' : ''} ${selectedFile === file.name ? 'bg-th-bg-muted' : ''}`}
                      onClick={() => { if (type) handleSelectFile(file.name); }}
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
                                className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50"
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
                              <button
                                onClick={() => setConfirmDelete(file.name)}
                                className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-100 transition"
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
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-th-text-dim">
              Page {page} of {totalPages} ({total} files)
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition disabled:opacity-40 disabled:cursor-not-allowed"
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
