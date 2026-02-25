import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Loader2, RefreshCw, ArrowLeft, StopCircle, ChevronDown } from 'lucide-react';
import { formatBytes } from './utils';

const FETCH_JOBS_INTERVAL = 10_000; // 10 seconds

type JobStatus = 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';

interface AdminJob {
  id: string;
  url: string;
  status: JobStatus;
  message?: string;
  filename: string;
  folder_key: string;
  total_bytes?: number;
  downloaded_bytes?: number;
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
  { value: 'cancelled', label: 'Cancelled' },
];

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    queued: 'bg-blue-100 text-blue-700',
    downloading: 'bg-yellow-100 text-yellow-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };

  const icons: Record<JobStatus, JSX.Element> = {
    queued: <Clock className="w-3.5 h-3.5" />,
    downloading: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    done: <CheckCircle className="w-3.5 h-3.5" />,
    error: <XCircle className="w-3.5 h-3.5" />,
    cancelled: <StopCircle className="w-3.5 h-3.5" />,
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


function SizeCell({ job }: { job: AdminJob }) {
  if (job.status === 'queued') return <span className="text-slate-300">—</span>;

  if (job.status === 'downloading') {
    const dl = job.downloaded_bytes ?? 0;
    if (job.total_bytes) {
      const pct = Math.min(100, Math.round((dl / job.total_bytes) * 100));
      return (
        <span className="text-slate-500 whitespace-nowrap">
          {formatBytes(dl)} / {formatBytes(job.total_bytes)}
          <span className="ml-1 text-xs text-slate-400">({pct}%)</span>
        </span>
      );
    }
    return <span className="text-slate-500 whitespace-nowrap">{formatBytes(dl)}</span>;
  }

  if (job.total_bytes != null) {
    return <span className="text-slate-500 whitespace-nowrap">{formatBytes(job.total_bytes)}</span>;
  }

  return <span className="text-slate-300">—</span>;
}

export default function AdminPage({ token, onUnauthorized, authEnabled }: AdminPageProps) {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [filter, setFilter] = useState<JobStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((jobId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const handleStop = useCallback(async (jobId: string) => {
    setStoppingIds((prev) => new Set(prev).add(jobId));
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (response.status === 401) { onUnauthorized(); return; }
      if (response.ok) {
        // Optimistically update the job status in local state on success
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, status: 'cancelled' as JobStatus, message: 'Download cancelled' } : j
          )
        );
      }
      // Non-ok responses (e.g. 400 if already completed): next poll will reflect real state
    } catch {
      // Network error — next poll will reflect the real state
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }, [token]);

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
    const interval = setInterval(fetchJobs, FETCH_JOBS_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  const counts: Record<JobStatus | 'all', number> = {
    all: jobs.length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    downloading: jobs.filter((j) => j.status === 'downloading').length,
    done: jobs.filter((j) => j.status === 'done').length,
    error: jobs.filter((j) => j.status === 'error').length,
    cancelled: jobs.filter((j) => j.status === 'cancelled').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '';
              }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </a>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">Download Jobs</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {lastRefreshed && (
              <span className="text-xs text-slate-400 whitespace-nowrap">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchJobs}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition text-slate-600 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            {authEnabled && (
              <button
                onClick={onUnauthorized}
                className="text-sm text-slate-400 hover:text-slate-700 transition whitespace-nowrap"
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
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 w-6"></th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Folder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((job) => {
                  const expanded = expandedIds.has(job.id);
                  return (
                    <React.Fragment key={job.id}>
                      <tr className="hover:bg-slate-50 transition">
                        {/* Expand toggle */}
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => toggleExpand(job.id)}
                            title={expanded ? 'Collapse details' : 'Expand details'}
                            className="text-slate-300 hover:text-slate-500 transition"
                          >
                            <ChevronDown
                              className={`w-4 h-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={job.status} />
                            {(job.status === 'queued' || job.status === 'downloading') && (
                              <button
                                onClick={() => handleStop(job.id)}
                                disabled={stoppingIds.has(job.id)}
                                title="Stop and remove"
                                className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {stoppingIds.has(job.id)
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <StopCircle className="w-3 h-3" />}
                                Stop
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-700">{job.filename}</span>
                          {(job.status !== 'queued' && (job.downloaded_bytes != null || job.total_bytes != null)) && (
                            <span className="block text-xs text-slate-400 mt-0.5">
                              <SizeCell job={job} />
                            </span>
                          )}
                          {job.message && (
                            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs" title={job.message}>
                              {job.message}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{job.folder_key}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={1} aria-hidden="true" />
                          <td colSpan={3} className="px-4 pb-3 pt-1">
                            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                              <div>
                                <dt className="text-slate-400 font-medium uppercase tracking-wide mb-0.5">URL</dt>
                                <dd>
                                  <a
                                    href={/^https?:\/\//i.test(job.url) ? job.url : '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-500 hover:text-slate-800 break-all transition"
                                    title={job.url}
                                  >
                                    {job.url}
                                  </a>
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-400 font-medium uppercase tracking-wide mb-0.5">Created</dt>
                                <dd className="text-slate-500">{formatDate(job.created_at)}</dd>
                              </div>
                              <div>
                                <dt className="text-slate-400 font-medium uppercase tracking-wide mb-0.5">Updated</dt>
                                <dd className="text-slate-500">{formatDate(job.updated_at)}</dd>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
