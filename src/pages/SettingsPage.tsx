import { useState, useEffect } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { Loader2, Save, Trash2 } from 'lucide-react';
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

  const setDays = (key: string, value: string) => {
    const num = parseInt(value, 10);
    setRules((prev) => ({ ...prev, [key]: isNaN(num) || num < 0 ? 0 : num }));
  };

  return (
    <div className="min-h-screen bg-th-bg text-th-text">
      <NavBar currentPage="settings" authEnabled={authEnabled} onSignOut={onUnauthorized} />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-lg font-semibold mb-1">Auto-Clean</h1>
        <p className="text-sm text-th-text-sub mb-5">
          Automatically delete files older than a specified number of days. Set to 0 to disable.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-th-text-dim py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading...
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-600">
            {success}
          </div>
        )}

        {!loading && folders.length === 0 && !error && (
          <p className="text-sm text-th-text-dim">No folders configured.</p>
        )}

        {!loading && folders.length > 0 && (
          <div className="space-y-3">
            {folders.map((key) => (
              <div
                key={key}
                className="flex items-center gap-3 p-3 bg-th-bg-surface border border-th-border-light rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{key}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Trash2 className="w-4 h-4 text-th-text-faint" />
                  <input
                    type="number"
                    min="0"
                    value={rules[key] || 0}
                    onChange={(e) => setDays(key, e.target.value)}
                    className="w-20 px-2 py-1.5 text-sm border border-th-border rounded-md bg-th-bg text-th-text text-center
                               focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition"
                  />
                  <span className="text-sm text-th-text-sub">days</span>
                </div>
              </div>
            ))}

            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-4 flex items-center gap-2 bg-th-btn text-th-btn-text py-2 px-4 rounded-lg
                         hover:bg-th-btn-hover disabled:bg-th-btn-disabled disabled:cursor-not-allowed transition text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
