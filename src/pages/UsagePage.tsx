import { useState, useEffect, useCallback } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { Activity, Loader2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import NavBar from '../components/NavBar';

interface UsageEntry {
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  statusCode: number;
  responseTimeMs: number;
}

interface UsagePageProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

const PAGE_SIZE = 50;

type DatePreset = 'day' | 'week' | 'month' | 'year' | 'custom';

function presetRange(preset: Exclude<DatePreset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
  const start = new Date(now);
  switch (preset) {
    case 'day':   start.setHours(0, 0, 0, 0); break;
    case 'week':  start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0); break;
    case 'month': start.setMonth(start.getMonth() - 1); start.setHours(0, 0, 0, 0); break;
    case 'year':  start.setFullYear(start.getFullYear() - 1); start.setHours(0, 0, 0, 0); break;
  }
  return { from: toLocalDatetime(start), to: toLocalDatetime(end) };
}

function methodColor(method: string) {
  switch (method) {
    case 'GET':    return 'bg-blue-500/15 text-blue-600';
    case 'POST':   return 'bg-green-500/15 text-green-600';
    case 'DELETE':  return 'bg-red-500/15 text-red-600';
    case 'PUT':    return 'bg-amber-500/15 text-amber-600';
    case 'PATCH':  return 'bg-purple-500/15 text-purple-600';
    default:       return 'bg-th-bg-muted text-th-text-dim';
  }
}

function statusColor(code: number) {
  if (code < 300) return 'text-green-600';
  if (code < 400) return 'text-amber-600';
  return 'text-red-600';
}

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UsagePage({ token, onUnauthorized, authEnabled }: UsagePageProps) {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date filter
  const [datePreset, setDatePreset] = useState<DatePreset>('day');
  const initRange = presetRange('day');
  const [from, setFrom] = useState(initRange.from);
  const [to, setTo] = useState(initRange.to);
  const [pathFilter, setPathFilter] = useState('');

  const authHeaders = useAuthHeaders(token);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      if (pathFilter) params.set('endpoint', pathFilter);
      const res = await fetch(`/api/usage?${params}`, { headers: authHeaders });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setEntries(data.entries);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized, page, from, to, pathFilter]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="usage" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Page title */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Activity className="w-6 h-6 shrink-0 text-th-text-sub" />
            <h1 className="text-xl sm:text-2xl font-semibold text-th-text">Usage Log</h1>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={fetchUsage}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition text-th-text-sub whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-th-bg rounded-lg border border-th-border-light p-3 sm:p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              {/* Period segmented control */}
              <div>
                <span className="block text-[10px] uppercase tracking-wider font-medium text-th-text-faint mb-1">Period</span>
                <div className="flex rounded-lg border border-th-border-light overflow-hidden">
                {([['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['custom', 'Custom']] as const).map(([key, label], i, arr) => (
                  <button
                    key={key}
                    onClick={() => {
                      setDatePreset(key);
                      if (key !== 'custom') {
                        const r = presetRange(key);
                        setFrom(r.from);
                        setTo(r.to);
                        setPage(1);
                      }
                    }}
                    className={`px-3 py-1.5 text-xs font-medium transition ${
                      i < arr.length - 1 ? 'border-r border-th-border-light' : ''
                    } ${
                      datePreset === key
                        ? 'bg-th-btn text-th-btn-text'
                        : 'bg-th-bg-alt text-th-text-dim hover:text-th-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                </div>
              </div>

              {/* Endpoint segmented control */}
              <div>
                <span className="block text-[10px] uppercase tracking-wider font-medium text-th-text-faint mb-1">Endpoint</span>
                <div className="flex rounded-lg border border-th-border-light overflow-hidden">
                {['auth', 'download', 'upload', 'browse'].map((s, i, arr) => {
                  const value = `/api/${s}`;
                  const active = pathFilter === value;
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        const next = active ? '' : value;
                        setPathFilter(next);
                        setPage(1);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium transition ${
                        i < arr.length - 1 ? 'border-r border-th-border-light' : ''
                      } ${
                        active
                          ? 'bg-th-btn text-th-btn-text'
                          : 'bg-th-bg-alt text-th-text-dim hover:text-th-text'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
                </div>
              </div>

              <span className="text-xs text-th-text-faint ml-auto self-end pb-1 tabular-nums">
                {total} request{total !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Custom date range */}
            {datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-th-text-dim mb-1">From</label>
                  <input
                    type="datetime-local"
                    value={from}
                    onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                    className="w-full px-3 py-1.5 text-sm bg-th-bg-alt border border-th-border-light rounded-lg text-th-text focus:outline-none focus:ring-1 focus:ring-th-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-th-text-dim mb-1">To</label>
                  <input
                    type="datetime-local"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setPage(1); }}
                    className="w-full px-3 py-1.5 text-sm bg-th-bg-alt border border-th-border-light rounded-lg text-th-text focus:outline-none focus:ring-1 focus:ring-th-ring"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-th-text-faint">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading usage data...
            </div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="py-20 text-center text-th-text-faint text-sm">
              No requests recorded for this time range.
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {entries.map((e, i) => (
                  <div key={i} className="bg-th-bg rounded-lg border border-th-border-light p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${methodColor(e.method)}`}>
                          {e.method}
                        </span>
                        <span className={`font-mono text-xs font-semibold ${statusColor(e.statusCode)}`}>{e.statusCode}</span>
                      </div>
                      <span className="text-th-text-dim text-xs">{e.responseTimeMs}ms</span>
                    </div>
                    <div className="font-mono text-xs text-th-text-sub truncate">{e.path}</div>
                    <div className="flex items-center justify-between gap-2 text-th-text-faint text-[11px]">
                      <span>{formatTs(e.timestamp)}</span>
                      <span className="font-mono">{e.ip}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block bg-th-bg rounded-lg shadow-sm border border-th-border-light overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-th-border-lighter bg-th-bg-alt text-left text-xs font-medium text-th-text-dim uppercase tracking-wide">
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Endpoint</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">IP</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3 hidden lg:table-cell">User Agent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-th-border-lighter">
                    {entries.map((e, i) => (
                      <tr key={i} className="hover:bg-th-bg-alt transition">
                        <td className="px-4 py-2.5 whitespace-nowrap text-th-text-dim font-mono text-xs">{formatTs(e.timestamp)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${methodColor(e.method)}`}>
                            {e.method}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-th-text-sub font-mono text-xs">{e.path}</td>
                        <td className={`px-4 py-2.5 whitespace-nowrap font-mono text-xs font-semibold ${statusColor(e.statusCode)}`}>{e.statusCode}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-th-text-dim font-mono text-xs">{e.ip}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-th-text-dim text-xs">{e.responseTimeMs}ms</td>
                        <td className="px-4 py-2.5 text-th-text-faint text-xs truncate max-w-xs hidden lg:table-cell" title={e.userAgent}>{e.userAgent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition text-th-text-sub disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                  <span className="text-sm text-th-text-dim">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg hover:bg-th-bg-alt transition text-th-text-sub disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
