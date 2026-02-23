import { useState, useEffect } from 'react';
import { Download, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface Config {
  folders: string[];
  allowedExtensions: string[];
}

interface DownloadJob {
  id: string;
  status: 'queued' | 'downloading' | 'done' | 'error';
  message?: string;
  filename?: string;
  folder_key?: string;
}

function App() {
  const [config, setConfig] = useState<Config>({ folders: [], allowedExtensions: [] });
  const [url, setUrl] = useState('');
  const [folderKey, setFolderKey] = useState('');
  const [filenameOverride, setFilenameOverride] = useState('');
  const [currentJob, setCurrentJob] = useState<DownloadJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (currentJob && (currentJob.status === 'queued' || currentJob.status === 'downloading')) {
      const interval = setInterval(() => {
        pollStatus(currentJob.id);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [currentJob]);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data: Config = await response.json();
      setConfig(data);
      setConfigError(null);
      if (data.folders.length > 0) {
        setFolderKey(data.folders[0]);
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
      setConfigError('Could not load configuration. Is the server running?');
    }
  };

  const pollStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/status/${jobId}`);
      if (!response.ok) {
        console.error('Status poll returned non-OK response:', response.status);
        return;
      }
      const data = await response.json();
      setCurrentJob(data);
    } catch (error) {
      console.error('Failed to poll status:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          folderKey,
          filenameOverride: filenameOverride || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCurrentJob({
          id: 'error',
          status: 'error',
          message: data.error || 'Failed to start download',
        });
      } else {
        setCurrentJob(data);
      }
    } catch (error) {
      setCurrentJob({
        id: 'error',
        status: 'error',
        message: error instanceof Error ? error.message : 'Network error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusIcon = () => {
    if (!currentJob) return null;

    switch (currentJob.status) {
      case 'queued':
        return <Clock className="w-5 h-5 text-blue-500" />;
      case 'downloading':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'done':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = () => {
    if (!currentJob) return null;

    switch (currentJob.status) {
      case 'queued':
        return 'Queued';
      case 'downloading':
        return 'Downloading...';
      case 'done':
        return 'Download complete';
      case 'error':
        return 'Error';
    }
  };

  const handleReset = () => {
    setCurrentJob(null);
    setUrl('');
    setFilenameOverride('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <Download className="w-8 h-8 text-slate-700" />
            <h1 className="text-2xl font-semibold text-slate-800">File Downloader</h1>
          </div>

          {configError && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {configError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-slate-700 mb-2">
                File URL
              </label>
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

            <div>
              <label htmlFor="folder" className="block text-sm font-medium text-slate-700 mb-2">
                Destination Folder
              </label>
              {config.folders.length === 0 ? (
                <p className="text-sm text-slate-500 italic">
                  No folders configured. Set <code className="bg-slate-100 px-1 rounded">DOWNLOAD_FOLDERS</code> in your <code className="bg-slate-100 px-1 rounded">.env</code> file.
                </p>
              ) : (
                <select
                  id="folder"
                  value={folderKey}
                  onChange={(e) => setFolderKey(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition bg-white"
                >
                  {config.folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              )}
            </div>

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

            {config.allowedExtensions.length > 0 && (
              <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
                <strong>Allowed extensions:</strong> {config.allowedExtensions.join(', ')}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !url || !folderKey}
              className="w-full bg-slate-700 text-white py-2.5 px-4 rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download File
                </>
              )}
            </button>
          </form>

          {currentJob && (
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                {getStatusIcon()}
                <span className="font-medium text-slate-800">{getStatusText()}</span>
              </div>
              {currentJob.message && (
                <p className="text-sm text-slate-600 ml-8">{currentJob.message}</p>
              )}
              {currentJob.filename && (
                <p className="text-sm text-slate-600 ml-8">
                  File: {currentJob.filename} → {currentJob.folder_key}
                </p>
              )}
              {(currentJob.status === 'done' || currentJob.status === 'error') && (
                <button
                  onClick={handleReset}
                  className="mt-3 ml-8 text-sm text-slate-600 hover:text-slate-800 underline"
                >
                  Start new download
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
