import { useState, useEffect } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { Loader2, Save, Timer, Folder, CheckCircle } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import NavBar from '../components/NavBar';

interface SettingsPageProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

interface AutoCleanData {
  rules: Record<string, number>;
  folders: string[];
}

const PRESETS = [7, 14, 30, 60, 90];

export default function SettingsPage({ token, onUnauthorized, authEnabled }: SettingsPageProps) {
  const headers = useAuthHeaders(token);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [rules, setRules] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetch('/api/auto-clean', { headers })
      .then((res) => {
        if (res.status === 401) { onUnauthorized(); return null; }
        if (!res.ok) throw new Error('Failed to load settings');
        return res.json();
      })
      .then((data: AutoCleanData | null) => {
        if (!data) return;
        setFolders(data.folders);
        setRules(data.rules);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/auto-clean', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleFolder = (key: string) => {
    setRules((prev) => ({ ...prev, [key]: prev[key] ? 0 : 30 }));
  };

  const enabledCount = folders.filter((k) => (rules[k] || 0) > 0).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="settings" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <PageTitle icon={Timer} title="Auto-Clean">
            {!loading && folders.length > 0 && (
              <div className="flex items-center gap-3 ml-auto">
                {success && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4" /> Saved
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-th-btn text-th-btn-text rounded-lg
                             hover:bg-th-btn-hover disabled:bg-th-btn-disabled disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </PageTitle>

          <p className="text-sm text-th-text-sub -mt-4 mb-5">
            Automatically delete files older than a retention period per folder.
            {folders.length > 0 && (
              <span className="ml-1 text-th-text-dim">
                {enabledCount} of {folders.length} folder{folders.length !== 1 ? 's' : ''} enabled.
              </span>
            )}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-th-text-dim py-20 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading...
            </div>
          )}

          {!loading && folders.length === 0 && !error && (
            <div className="py-20 text-center text-th-text-faint text-sm">No folders configured.</div>
          )}

          {!loading && folders.length > 0 && (
            <div className="space-y-3">
              {folders.map((key) => {
                const days = rules[key] || 0;
                const enabled = days > 0;
                const isCustom = enabled && !PRESETS.includes(days);

                return (
                  <div
                    key={key}
                    className={`rounded-lg border transition ${
                      enabled
                        ? 'bg-th-bg border-th-border-light'
                        : 'bg-th-bg/60 border-th-border-lighter'
                    }`}
                  >
                    {/* Header row: folder name + toggle */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Folder className={`w-4 h-4 shrink-0 ${enabled ? 'text-th-text-sub' : 'text-th-text-faint'}`} />
                      <span className={`text-sm font-medium truncate ${enabled ? 'text-th-text' : 'text-th-text-dim'}`}>
                        {key}
                      </span>
                      <div className="ml-auto flex items-center gap-2.5 shrink-0">
                        <span className={`text-xs ${enabled ? 'text-th-text-sub' : 'text-th-text-faint'}`}>
                          {enabled ? `${days}d` : 'Off'}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => toggleFolder(key)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            enabled ? 'bg-th-btn' : 'bg-th-bg-muted'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Preset buttons — shown when enabled */}
                    {enabled && (
                      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                        {PRESETS.map((p) => (
                          <button
                            key={p}
                            onClick={() => setRules((prev) => ({ ...prev, [key]: p }))}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition border ${
                              days === p
                                ? 'bg-th-btn text-th-btn-text border-th-btn'
                                : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
                            }`}
                          >
                            {p}d
                          </button>
                        ))}
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="1"
                            value={isCustom ? days : ''}
                            placeholder="Custom"
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!isNaN(v) && v > 0) setRules((prev) => ({ ...prev, [key]: v }));
                            }}
                            className={`w-[4.5rem] px-2 py-1 text-xs border rounded-md bg-th-bg text-th-text text-center
                                       focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition ${
                              isCustom ? 'border-th-btn' : 'border-th-border-light'
                            }`}
                          />
                          <span className="text-xs text-th-text-faint">days</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
