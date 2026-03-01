import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Loader2, CheckCircle, XCircle, Clock, Upload, Link, UploadCloud, Magnet } from 'lucide-react';
import { formatBytes } from './utils';

interface Config {
  folders: string[];
  allowedExtensions: string[];
}

interface DownloadJob {
  id: string;
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';
  message?: string;
  filename?: string;
  folder_key?: string;
  total_bytes?: number;
  downloaded_bytes?: number;
  type?: 'http' | 'torrent';
  peers?: number;
  download_speed?: number;
}

interface AppProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

type Mode = 'url' | 'upload' | 'torrent';

function App({ token, onUnauthorized, authEnabled }: AppProps) {
  const [config, setConfig] = useState<Config>({ folders: [], allowedExtensions: [] });
  const [mode, setMode] = useState<Mode>('url');

  // URL mode state
  const [url, setUrl] = useState('');
  const [filenameOverride, setFilenameOverride] = useState('');

  // Upload mode state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadFilenameOverride, setUploadFilenameOverride] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Torrent mode state
  const [magnetUrl, setMagnetUrl] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [isDraggingTorrent, setIsDraggingTorrent] = useState(false);
  const torrentInputRef = useRef<HTMLInputElement>(null);

  // Shared state
  const [folderKey, setFolderKey] = useState('');
  const [currentJob, setCurrentJob] = useState<DownloadJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (currentJob && (currentJob.status === 'queued' || currentJob.status === 'downloading')) {
      const interval = setInterval(() => pollStatus(currentJob.id), 1000);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJob?.id, currentJob?.status]);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config', { headers: authHeaders });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data: Config = await response.json();
      setConfig(data);
      setConfigError(null);
      if (data.folders.length > 0) setFolderKey(data.folders[0]);
    } catch (error) {
      console.error('Failed to fetch config:', error);
      setConfigError('Could not load configuration. Is the server running?');
    }
  };

  const pollStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/status/${jobId}`, { headers: authHeaders });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) return;
      const data = await response.json();
      setCurrentJob(data);
    } catch (error) {
      console.error('Failed to poll status:', error);
    }
  };

  // ── URL submit ──────────────────────────────────────────────────────────────
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, folderKey, filenameOverride: filenameOverride || undefined }),
      });
      if (response.status === 401) { onUnauthorized(); return; }
      const data = await response.json();
      setCurrentJob(response.ok ? data : { id: 'error', status: 'error', message: data.error || 'Failed to start download' });
    } catch (error) {
      setCurrentJob({ id: 'error', status: 'error', message: error instanceof Error ? error.message : 'Network error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Upload submit ───────────────────────────────────────────────────────────
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('folderKey', folderKey);
      if (uploadFilenameOverride) formData.append('filenameOverride', uploadFilenameOverride);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: authHeaders, // no Content-Type — browser sets multipart boundary
        body: formData,
      });
      if (response.status === 401) { onUnauthorized(); return; }
      const data = await response.json();
      setCurrentJob(response.ok ? { ...data, status: 'done' } : { id: 'error', status: 'error', message: data.error || 'Upload failed' });
    } catch (error) {
      setCurrentJob({ id: 'error', status: 'error', message: error instanceof Error ? error.message : 'Network error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Torrent submit ──────────────────────────────────────────────────────────
  const handleTorrentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magnetUrl && !torrentFile) return;
    setIsSubmitting(true);
    try {
      let response: Response;
      if (torrentFile) {
        const formData = new FormData();
        formData.append('torrent', torrentFile);
        formData.append('folderKey', folderKey);
        response = await fetch('/api/torrent', {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });
      } else {
        response = await fetch('/api/torrent', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ magnet: magnetUrl, folderKey }),
        });
      }
      if (response.status === 401) { onUnauthorized(); return; }
      const data = await response.json();
      setCurrentJob(response.ok ? data : { id: 'error', status: 'error', message: data.error || 'Failed to start torrent' });
    } catch (error) {
      setCurrentJob({ id: 'error', status: 'error', message: error instanceof Error ? error.message : 'Network error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  // ── Status helpers ──────────────────────────────────────────────────────────
  const getStatusIcon = () => {
    if (!currentJob) return null;
    switch (currentJob.status) {
      case 'queued':      return <Clock className="w-5 h-5 text-blue-500" />;
      case 'downloading': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'done':        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':       return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = () => {
    if (!currentJob) return null;
    switch (currentJob.status) {
      case 'queued':      return 'Queued';
      case 'downloading': return currentJob.type === 'torrent' ? 'Downloading torrent...' : 'Downloading...';
      case 'done':        return mode === 'upload' ? 'Upload complete' : 'Download complete';
      case 'cancelled':   return 'Cancelled';
      case 'error':       return 'Error';
    }
  };

  const handleReset = () => {
    setCurrentJob(null);
    setUrl('');
    setFilenameOverride('');
    setSelectedFile(null);
    setUploadFilenameOverride('');
    setMagnetUrl('');
    setTorrentFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (torrentInputRef.current) torrentInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-lg shadow-lg p-5 sm:p-8">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Download className="w-7 h-7 shrink-0 text-slate-700" />
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-tight">File Downloader</h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <a href="#/admin" className="text-sm text-slate-400 hover:text-slate-700 transition underline underline-offset-2">
                Admin
              </a>
              {authEnabled && (
                <button onClick={onUnauthorized} className="text-sm text-slate-400 hover:text-slate-700 transition whitespace-nowrap" title="Sign out">
                  Sign out
                </button>
              )}
            </div>
          </div>

          {configError && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {configError}
            </div>
          )}

          {/* Mode tabs */}
          <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => { setMode('url'); handleReset(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition ${
                mode === 'url' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Link className="w-4 h-4" />
              From URL
            </button>
            <button
              type="button"
              onClick={() => { setMode('upload'); handleReset(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition ${
                mode === 'upload' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload File
            </button>
            <button
              type="button"
              onClick={() => { setMode('torrent'); handleReset(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition ${
                mode === 'torrent' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Magnet className="w-4 h-4" />
              Torrent
            </button>
          </div>

          {/* ── URL mode ── */}
          {mode === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-5">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-slate-700 mb-2">File URL</label>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="https://example.com/file.jpg"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition"
                />
              </div>

              <FolderSelect folders={config.folders} value={folderKey} onChange={setFolderKey} />

              <div>
                <label htmlFor="filename" className="block text-sm font-medium text-slate-700 mb-2">
                  Filename Override <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="filename"
                  type="text"
                  value={filenameOverride}
                  onChange={(e) => setFilenameOverride(e.target.value)}
                  placeholder="custom-name.jpg"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition"
                />
              </div>

              <AllowedExtensionsHint extensions={config.allowedExtensions} />

              <button
                type="submit"
                disabled={isSubmitting || !url || !folderKey}
                className="w-full bg-slate-700 text-white py-2.5 px-4 rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting...</> : <><Download className="w-4 h-4" />Download File</>}
              </button>
            </form>
          )}

          {/* ── Upload mode ── */}
          {mode === 'upload' && (
            <form onSubmit={handleUploadSubmit} className="space-y-5">
              {/* Drop zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 cursor-pointer transition ${
                  isDragging
                    ? 'border-slate-500 bg-slate-50'
                    : selectedFile
                    ? 'border-green-400 bg-green-50'
                    : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {selectedFile ? (
                  <>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                    <div className="text-center w-full min-w-0">
                      <p className="font-medium text-slate-800 break-all">{selectedFile.name}</p>
                      <p className="text-sm text-slate-500">{formatBytes(selectedFile.size)}</p>
                    </div>
                    <p className="text-xs text-slate-400">Click or drop to replace</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className={`w-10 h-10 ${isDragging ? 'text-slate-600' : 'text-slate-400'}`} />
                    <div className="text-center">
                      <p className="font-medium text-slate-700">Drop a file here</p>
                      <p className="text-sm text-slate-500">or click to browse</p>
                    </div>
                  </>
                )}
              </div>

              <FolderSelect folders={config.folders} value={folderKey} onChange={setFolderKey} />

              <div>
                <label htmlFor="upload-filename" className="block text-sm font-medium text-slate-700 mb-2">
                  Save as <span className="text-slate-400 font-normal">(optional — defaults to original filename)</span>
                </label>
                <input
                  id="upload-filename"
                  type="text"
                  value={uploadFilenameOverride}
                  onChange={(e) => setUploadFilenameOverride(e.target.value)}
                  placeholder={selectedFile?.name || 'custom-name.jpg'}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition"
                />
              </div>

              <AllowedExtensionsHint extensions={config.allowedExtensions} />

              <button
                type="submit"
                disabled={isSubmitting || !selectedFile || !folderKey}
                className="w-full bg-slate-700 text-white py-2.5 px-4 rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading...</> : <><Upload className="w-4 h-4" />Upload File</>}
              </button>
            </form>
          )}

          {/* ── Torrent mode ── */}
          {mode === 'torrent' && (
            <form onSubmit={handleTorrentSubmit} className="space-y-5">
              {/* Magnet link input */}
              <div>
                <label htmlFor="magnet" className="block text-sm font-medium text-slate-700 mb-2">Magnet Link</label>
                <input
                  id="magnet"
                  type="text"
                  value={magnetUrl}
                  onChange={(e) => { setMagnetUrl(e.target.value); if (e.target.value) setTorrentFile(null); }}
                  placeholder="magnet:?xt=urn:btih:..."
                  disabled={!!torrentFile}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {/* Or divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">OR</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* .torrent file drop zone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">.torrent File</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); if (!magnetUrl) setIsDraggingTorrent(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDraggingTorrent(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingTorrent(false);
                    if (magnetUrl) return;
                    const file = e.dataTransfer.files[0];
                    if (file) setTorrentFile(file);
                  }}
                  onClick={() => { if (!magnetUrl) torrentInputRef.current?.click(); }}
                  className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 transition ${
                    magnetUrl
                      ? 'border-slate-200 bg-slate-50 opacity-40 cursor-not-allowed'
                      : isDraggingTorrent
                      ? 'border-slate-500 bg-slate-50 cursor-pointer'
                      : torrentFile
                      ? 'border-green-400 bg-green-50 cursor-pointer'
                      : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50 cursor-pointer'
                  }`}
                >
                  <input
                    ref={torrentInputRef}
                    type="file"
                    accept=".torrent"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { setTorrentFile(f); setMagnetUrl(''); } }}
                  />
                  {torrentFile ? (
                    <>
                      <CheckCircle className="w-6 h-6 text-green-500" />
                      <p className="text-sm font-medium text-slate-800 break-all text-center">{torrentFile.name}</p>
                      <p className="text-xs text-slate-400">Click or drop to replace</p>
                    </>
                  ) : (
                    <>
                      <Magnet className={`w-7 h-7 ${isDraggingTorrent ? 'text-slate-600' : 'text-slate-400'}`} />
                      <p className="text-sm text-slate-500">Drop a <code className="bg-slate-100 px-1 rounded">.torrent</code> file here or click to browse</p>
                    </>
                  )}
                </div>
              </div>

              <FolderSelect folders={config.folders} value={folderKey} onChange={setFolderKey} />

              <button
                type="submit"
                disabled={isSubmitting || (!magnetUrl && !torrentFile) || !folderKey}
                className="w-full bg-slate-700 text-white py-2.5 px-4 rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
              >
                {isSubmitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Starting...</>
                  : <><Magnet className="w-4 h-4" />Start Torrent</>}
              </button>
            </form>
          )}

          {/* Status panel */}
          {currentJob && (
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                {getStatusIcon()}
                <span className="font-medium text-slate-800">{getStatusText()}</span>
              </div>
              {currentJob.status === 'downloading' && (
                <div className="ml-8 mt-1">
                  {currentJob.total_bytes ? (
                    (() => {
                      const pct = Math.min(100, Math.round(((currentJob.downloaded_bytes ?? 0) / currentJob.total_bytes) * 100));
                      return (
                        <>
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>{formatBytes(currentJob.downloaded_bytes ?? 0)} / {formatBytes(currentJob.total_bytes)}</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5">
                            <div
                              className="bg-slate-600 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </>
                      );
                    })()
                  ) : currentJob.downloaded_bytes != null ? (
                    <p className="text-xs text-slate-500">{formatBytes(currentJob.downloaded_bytes)} downloaded</p>
                  ) : null}
                </div>
              )}
              {currentJob.status === 'downloading' && currentJob.type === 'torrent' && (
                <p className="text-xs text-slate-500 ml-8 mt-1">
                  {currentJob.peers ?? 0} {(currentJob.peers ?? 0) === 1 ? 'peer' : 'peers'}
                  {currentJob.download_speed ? ` · ${formatBytes(currentJob.download_speed)}/s` : ''}
                </p>
              )}
              {currentJob.status === 'done' && currentJob.total_bytes != null && (
                <p className="text-xs text-slate-500 ml-8 mt-1">{formatBytes(currentJob.total_bytes)}</p>
              )}
              {currentJob.message && (
                <p className="text-sm text-slate-600 ml-8 mt-1 break-all">{currentJob.message}</p>
              )}
              {currentJob.filename && (
                <p className="text-sm text-slate-600 ml-8 break-all">
                  <span className="font-medium">File:</span> {currentJob.filename}
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="text-slate-500">{currentJob.folder_key}</span>
                </p>
              )}
              {(currentJob.status === 'done' || currentJob.status === 'error' || currentJob.status === 'cancelled') && (
                <button onClick={handleReset} className="mt-3 ml-8 text-sm text-slate-600 hover:text-slate-800 underline">
                  {mode === 'upload' ? 'Upload another file' : mode === 'torrent' ? 'Start new torrent' : 'Start new download'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function FolderSelect({ folders, value, onChange }: { folders: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor="folder" className="block text-sm font-medium text-slate-700 mb-2">
        Destination Folder
      </label>
      {folders.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No folders configured. Set <code className="bg-slate-100 px-1 rounded">DOWNLOAD_FOLDERS</code> in your <code className="bg-slate-100 px-1 rounded">.env</code> file.
        </p>
      ) : (
        <select
          id="folder"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition bg-white"
        >
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function AllowedExtensionsHint({ extensions }: { extensions: string[] }) {
  if (extensions.length === 0) return null;
  return (
    <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
      <strong>Allowed extensions:</strong> {extensions.join(', ')}
    </div>
  );
}

export default App;
