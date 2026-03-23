import { useState, useEffect, useCallback } from 'react';
import { Folder, Film, Music, Image, FileText, FileCode, Download, X, ChevronLeft, ChevronRight, LogOut, Trash2 } from 'lucide-react';
import { formatBytes, getMediaType } from './utils';

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
    default:      return <FileText className="w-4 h-4 text-slate-400" />;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function BrowsePage({ token, onUnauthorized, authEnabled }: BrowsePageProps) {
  const [folders, setFolders] = useState<string[]>([]);
  const [folderKey, setFolderKey] = useState('');
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Nav bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <a href="#" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition">File Manager</a>
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1 text-sm">
              <a href="#" className="px-2 py-1 rounded text-slate-500 hover:text-slate-800 transition">Download</a>
              <a href="#/browse" className="px-2 py-1 rounded bg-slate-200 text-slate-800 font-medium">Browse</a>
              <a href="#/admin" className="px-2 py-1 rounded text-slate-500 hover:text-slate-800 transition">Admin</a>
            </nav>
            {authEnabled && (
              <button onClick={onUnauthorized} className="text-slate-400 hover:text-slate-700 transition" title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Page title */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Folder className="w-6 h-6 shrink-0 text-slate-700" />
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">Browse Files</h1>
        </div>

        {/* Folder selector */}
        {folders.length > 0 && (
          <div className="mb-4">
            <select
              value={folderKey}
              onChange={(e) => handleFolderChange(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition bg-white text-sm"
            >
              {folders.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Media viewer */}
        {selectedFile && (
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-medium text-slate-700 truncate">{selectedFile}</span>
              <button onClick={() => { setSelectedFile(null); setTextContent(null); }} className="text-slate-400 hover:text-slate-700 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            {mediaType === 'text' ? (
              <div className="max-h-[70vh] overflow-auto bg-slate-50">
                {textLoading ? (
                  <div className="p-6 text-center text-slate-400 text-sm">Loading...</div>
                ) : (
                  <pre className="p-4 text-sm text-slate-700 font-mono whitespace-pre-wrap break-all">{textContent}</pre>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center p-4 bg-slate-900 min-h-[200px]">
                {mediaType === 'video' && (
                  <video
                    key={selectedFile}
                    src={fileUrl(selectedFile)}
                    controls
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
          <div className="py-20 text-center text-slate-400 text-sm">Loading...</div>
        ) : files.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-sm">No files in this folder.</div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 w-28">Size</th>
                  <th className="px-4 py-3 w-44">Modified</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map((file) => {
                  const type = getMediaType(file.name);
                  return (
                    <tr
                      key={file.name}
                      className={`hover:bg-slate-50 transition ${type ? 'cursor-pointer' : ''} ${selectedFile === file.name ? 'bg-slate-100' : ''}`}
                      onClick={() => { if (type) handleSelectFile(file.name); }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MediaIcon filename={file.name} />
                          <span className="font-medium text-slate-700 break-all">{file.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatBytes(file.size)}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(file.modifiedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="relative overflow-hidden w-16 h-5">
                          <div className={`absolute inset-0 flex items-center gap-2 transition-transform duration-150 ${confirmDelete === file.name ? '-translate-x-full' : 'translate-x-0'}`}>
                            <a
                              href={fileUrl(file.name)}
                              download={file.name}
                              onClick={(e) => e.stopPropagation()}
                              className="text-slate-400 hover:text-slate-700 transition"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(file.name); }}
                              className="text-slate-300 hover:text-red-500 transition"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div
                            className={`absolute inset-0 flex items-center gap-1 transition-transform duration-150 ${confirmDelete === file.name ? 'translate-x-0' : 'translate-x-full'}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => handleDelete(file.name)}
                              disabled={deleting}
                              className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                            >
                              {deleting ? 'Deleting…' : 'Delete?'}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              No
                            </button>
                          </div>
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
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-slate-500">
              Page {page} of {totalPages} ({total} files)
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
