import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Loader2, RefreshCw, ArrowLeft } from 'lucide-react';

type JobStatus = 'queued' | 'downloading' | 'done' | 'error';

interface AdminJob {
  id: string;
  url: string;
  status: JobStatus;
  message?: string;
  filename: string;
  folder_key: string;
  created_at: string;
  updated_at: string;
}

interface AdminPageProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'done', label: 'Done' },
  { value: 'error', label: 'Error' },
];

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    queued: 'bg-blue-100 text-blue-700',
    downloading: 'bg-yellow-100 text-yellow-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };

  const icons: Record<JobStatus, JSX.Element> = {
    queued: <Clock className="w-3.5 h-3.5" />,
    downloading: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    done: <CheckCircle className="w-3.5 h-3.5" />,
    error: <XCircle className="w-3.5 h-3.5" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function truncateUrl(url: string, max = 60) {
  return url.length > max ? url.slice(0, max) + '…' : url;
}

export default function AdminPage({ token, onUnauthorized, authEnabled }: AdminPageProps) {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [filter, setFilter] = useState<JobStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs', { headers: authHeaders });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data: AdminJob[] = await response.json();
      setJobs(data);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  const counts: Record<JobStatus | 'all', number> = {
    all: jobs.length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    downloading: jobs.filter((j) => j.status === 'downloading').length,
    done: jobs.filter((j) => j.status === 'done').length,
    error: jobs.filter((j) => j.status === 'error').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '';
              }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </a>
            <h1 className="text-2xl font-semibold text-slate-800">Download Jobs</h1>
          </div>
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <span className="text-xs text-slate-400">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchJobs}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition text-slate-600"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            {authEnabled && (
              <button
                onClick={onUnauthorized}
                className="text-sm text-slate-400 hover:text-slate-700 transition"
                title="Sign out"
              >
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition border ${
                filter === value
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
              <span
                className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  filter === value ? 'bg-slate-600 text-slate-200' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading jobs…
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-sm">
            No jobs{filter !== 'all' ? ` with status "${filter}"` : ''}.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Folder</th>
                  <th className="px-4 py-3 hidden md:table-cell">URL</th>
                  <th className="px-4 py-3 hidden lg:table-cell">Created</th>
                  <th className="px-4 py-3 hidden lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-700">{job.filename}</span>
                      {job.message && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs" title={job.message}>
                          {job.message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{job.folder_key}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-slate-700 transition truncate block max-w-xs"
                        title={job.url}
                      >
                        {truncateUrl(job.url)}
                      </a>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-400 whitespace-nowrap">
                      {formatDate(job.created_at)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-400 whitespace-nowrap">
                      {formatDate(job.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
