import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { CheckCircle, XCircle, Clock, Loader2, RefreshCw, StopCircle, ChevronDown, ClipboardList } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import { formatBytes, formatDate } from '../utils';
import NavBar from '../components/NavBar';
import { isTerminalTransition, sendJobNotification } from '../notifications';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';

const FETCH_JOBS_INTERVAL = 10_000; // 10 seconds

type JobStatus = 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';

interface QueueJob {
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
  type?: 'http' | 'torrent' | 'ytdlp';
  download_speed?: number;
  ytdlp_percent?: number;
  ytdlp_speed?: string;
  ytdlp_eta?: string;
  ytdlp_phase?: 'downloading' | 'postprocessing';
}

function getJobDisplayName(job: QueueJob): string {
  if (job.filename) return job.filename;
  return job.type === 'ytdlp' ? 'Resolving title...' : job.url;
}

interface QueuePageProps {
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
    queued: 'bg-blue-500/15 text-blue-600',
    downloading: 'bg-yellow-500/15 text-yellow-600',
    done: 'bg-green-500/15 text-green-600',
    error: 'bg-red-500/15 text-red-600',
    cancelled: 'bg-th-bg-muted text-th-text-dim',
  };

  const icons: Record<JobStatus, React.ReactNode> = {
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



function SizeCell({ job }: { job: QueueJob }) {
  if (job.status === 'queued') return <span className="text-th-text-faint">—</span>;

  // yt-dlp jobs: show percent + speed instead of byte counts
  if (job.type === 'ytdlp' && job.status === 'downloading') {
    if (job.ytdlp_phase === 'postprocessing') {
      return <span className="text-th-text-dim whitespace-nowrap">Converting...</span>;
    }
    if (job.ytdlp_percent != null && job.ytdlp_percent >= 0) {
      return (
        <span className="text-th-text-dim whitespace-nowrap">
          {Math.round(job.ytdlp_percent)}%
          {job.ytdlp_speed ? <span className="ml-1 text-xs text-th-text-faint">({job.ytdlp_speed})</span> : null}
        </span>
      );
    }
    return <span className="text-th-text-dim whitespace-nowrap">Starting...</span>;
  }

  if (job.status === 'downloading') {
    const dl = job.downloaded_bytes ?? 0;
    const speedStr = job.download_speed ? `${formatBytes(job.download_speed)}/s` : null;
    if (job.total_bytes) {
      const pct = Math.min(100, Math.round((dl / job.total_bytes) * 100));
      return (
        <span className="text-th-text-dim whitespace-nowrap">
          {formatBytes(dl)} / {formatBytes(job.total_bytes)}
          <span className="ml-1 text-xs text-th-text-faint">({pct}%{speedStr ? ` · ${speedStr}` : ''})</span>
        </span>
      );
    }
    return (
      <span className="text-th-text-dim whitespace-nowrap">
        {formatBytes(dl)}
        {speedStr ? <span className="ml-1 text-xs text-th-text-faint">({speedStr})</span> : null}
      </span>
    );
  }

  if (job.total_bytes != null) {
    return <span className="text-th-text-dim whitespace-nowrap">{formatBytes(job.total_bytes)}</span>;
  }

  return <span className="text-th-text-faint">—</span>;
}

export default function QueuePage({ token, onUnauthorized, authEnabled }: QueuePageProps) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [filter, setFilter] = useState<JobStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const prevStatusMapRef = useRef<Map<string, JobStatus>>(new Map());

  const toggleExpand = useCallback((jobId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const authHeaders = useAuthHeaders(token);

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
  }, [authHeaders, onUnauthorized]);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs', { headers: authHeaders });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data: QueueJob[] = await response.json();

      // Detect state transitions and notify
      const prevMap = prevStatusMapRef.current;
      if (prevMap.size > 0) {
        for (const job of data) {
          const prev = prevMap.get(job.id);
          if (isTerminalTransition(prev, job.status)) {
            sendJobNotification(job.filename, job.status, job.message);
          }
        }
      }
      const nextMap = new Map<string, JobStatus>();
      for (const job of data) nextMap.set(job.id, job.status);
      prevStatusMapRef.current = nextMap;

      setJobs(data);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  const pullRefresh = usePullToRefresh(fetchJobs);

  const hasActiveJobs = jobs.some(j => j.status === 'queued' || j.status === 'downloading');

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(fetchJobs, FETCH_JOBS_INTERVAL);
    return () => clearInterval(interval);
  }, [hasActiveJobs, fetchJobs]);

  const filtered = useMemo(
    () => filter === 'all' ? jobs : jobs.filter((j) => j.status === filter),
    [jobs, filter],
  );

  const counts = useMemo(() => {
    const c: Record<JobStatus | 'all', number> = { all: jobs.length, queued: 0, downloading: 0, done: 0, error: 0, cancelled: 0 };
    for (const j of jobs) c[j.status]++;
    return c;
  }, [jobs]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="queue" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6" ref={pullRefresh.containerRef}>
      <PullToRefreshIndicator pullDistance={pullRefresh.pullDistance} refreshing={pullRefresh.refreshing} />
      <div className="max-w-5xl mx-auto">
        <PageTitle icon={ClipboardList} title="Download Jobs">
          <div className="flex items-center gap-2 ml-auto">
            {lastRefreshed && (
              <span className="text-xs text-th-text-faint whitespace-nowrap">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchJobs}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition text-th-text-sub whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </PageTitle>

        {/* Filter tabs — horizontally scrollable on mobile */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible scrollbar-none">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition border whitespace-nowrap shrink-0 ${
                filter === value
                  ? 'bg-th-btn text-th-btn-text border-th-btn'
                  : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
              }`}
            >
              {label}
              <span
                className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  filter === value ? 'bg-th-progress-fill text-th-text-faint' : 'bg-th-bg-muted text-th-text-dim'
                }`}
              >
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-th-text-faint">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading jobs…
          </div>
        ) : error ? (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-th-text-faint text-sm">
            No jobs{filter !== 'all' ? ` with status "${filter}"` : ''}.
          </div>
        ) : (
          <>
          {/* Mobile: card layout */}
          <div className="sm:hidden space-y-2">
            {filtered.map((job) => {
              const expanded = expandedIds.has(job.id);
              const canStop = job.status === 'queued' || job.status === 'downloading';
              return (
                <div
                  key={job.id}
                  className="bg-th-bg rounded-lg border border-th-border-light overflow-hidden"
                  onClick={() => toggleExpand(job.id)}
                >
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <StatusBadge status={job.status} />
                      <div className="flex items-center gap-2">
                        {canStop && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStop(job.id); }}
                            disabled={stoppingIds.has(job.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {stoppingIds.has(job.id)
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <StopCircle className="w-3 h-3" />}
                            Stop
                          </button>
                        )}
                        <ChevronDown className={`w-4 h-4 text-th-text-faint transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    <p className="font-medium text-th-text-sub text-sm truncate" title={getJobDisplayName(job)}>{getJobDisplayName(job)}</p>
                    <p className="text-xs text-th-text-faint mt-0.5">{job.folder_key}</p>
                    {job.status === 'downloading' && job.type === 'ytdlp' && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-th-bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${job.ytdlp_phase === 'postprocessing' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'}`}
                            style={{ width: job.ytdlp_phase === 'postprocessing' ? '100%' : `${Math.max(0, Math.min(100, Math.round(job.ytdlp_percent ?? 0)))}%` }}
                          />
                        </div>
                        <span className="text-xs text-th-text-faint mt-1 block">
                          <SizeCell job={job} />
                        </span>
                      </div>
                    )}
                    {job.status === 'downloading' && job.type !== 'ytdlp' && job.total_bytes != null && job.total_bytes > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-th-bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-yellow-500 transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.round(((job.downloaded_bytes ?? 0) / job.total_bytes) * 100))}%` }}
                          />
                        </div>
                        <span className="text-xs text-th-text-faint mt-1 block">
                          <SizeCell job={job} />
                        </span>
                      </div>
                    )}
                    {job.status === 'downloading' && job.type !== 'ytdlp' && (job.total_bytes == null || job.total_bytes === 0) && job.downloaded_bytes != null && (
                      <span className="text-xs text-th-text-faint mt-1 block">
                        <SizeCell job={job} />
                      </span>
                    )}
                    {job.status !== 'queued' && job.status !== 'downloading' && (job.downloaded_bytes != null || job.total_bytes != null) && (
                      <span className="text-xs text-th-text-faint mt-1 block">
                        <SizeCell job={job} />
                      </span>
                    )}
                    {job.message && (
                      <p className="text-xs text-th-text-faint mt-0.5 truncate" title={job.message}>
                        {job.message}
                      </p>
                    )}
                  </div>
                  {expanded && (
                    <div className="px-4 py-2.5 bg-th-bg-alt border-t border-th-border-lighter">
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-th-text-faint font-medium uppercase tracking-wide">URL</span>
                          <a
                            href={/^https?:\/\//i.test(job.url) ? job.url : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-th-text-dim break-all mt-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {job.url}
                          </a>
                        </div>
                        <div className="flex gap-4">
                          <div>
                            <span className="text-th-text-faint font-medium uppercase tracking-wide">Created</span>
                            <p className="text-th-text-dim mt-0.5">{formatDate(job.created_at)}</p>
                          </div>
                          <div>
                            <span className="text-th-text-faint font-medium uppercase tracking-wide">Updated</span>
                            <p className="text-th-text-dim mt-0.5">{formatDate(job.updated_at)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop: table layout */}
          <div className="hidden sm:block bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th-border-lighter bg-th-bg-alt text-left text-xs font-medium text-th-text-dim uppercase tracking-wide">
                  <th className="px-4 py-3 w-6"></th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Folder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-border-lighter">
                {filtered.map((job) => {
                  const expanded = expandedIds.has(job.id);
                  const canStop = job.status === 'queued' || job.status === 'downloading';
                  return (
                    <React.Fragment key={job.id}>
                      <tr className="hover:bg-th-bg-alt transition cursor-pointer" onClick={() => toggleExpand(job.id)}>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(job.id); }}
                            title={expanded ? 'Collapse details' : 'Expand details'}
                            className="text-th-text-faint hover:text-th-text-dim transition"
                          >
                            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={job.status} />
                            {canStop && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleStop(job.id); }}
                                disabled={stoppingIds.has(job.id)}
                                title="Stop and remove"
                                className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                          <span className="font-medium text-th-text-sub">{getJobDisplayName(job)}</span>
                          {(job.status !== 'queued' && (job.downloaded_bytes != null || job.total_bytes != null)) && (
                            <span className="block text-xs text-th-text-faint mt-0.5">
                              <SizeCell job={job} />
                            </span>
                          )}
                          {job.message && (
                            <p className="text-xs text-th-text-faint mt-0.5 truncate max-w-xs" title={job.message}>
                              {job.message}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-th-text-dim whitespace-nowrap">{job.folder_key}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-th-bg-alt">
                          <td colSpan={1} aria-hidden="true" />
                          <td colSpan={3} className="px-4 pb-3 pt-1">
                            <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                              <div>
                                <dt className="text-th-text-faint font-medium uppercase tracking-wide mb-0.5">URL</dt>
                                <dd>
                                  <a
                                    href={/^https?:\/\//i.test(job.url) ? job.url : '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-th-text-dim hover:text-th-text break-all transition"
                                    title={job.url}
                                  >
                                    {job.url}
                                  </a>
                                </dd>
                              </div>
                              <div>
                                <dt className="text-th-text-faint font-medium uppercase tracking-wide mb-0.5">Created</dt>
                                <dd className="text-th-text-dim">{formatDate(job.created_at)}</dd>
                              </div>
                              <div>
                                <dt className="text-th-text-faint font-medium uppercase tracking-wide mb-0.5">Updated</dt>
                                <dd className="text-th-text-dim">{formatDate(job.updated_at)}</dd>
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
          </>
        )}
      </div>
      </div>
    </div>
  );
}
