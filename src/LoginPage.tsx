import { useState, FormEvent } from 'react';
import { Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

interface LoginPageProps {
  onSuccess: (token: string) => void;
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      onSuccess(data.token as string);
    } catch {
      setError('Could not reach the server. Is it running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to flex items-center justify-center p-4">
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="bg-th-bg rounded-lg shadow-lg p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-th-bg-muted rounded-full flex items-center justify-center mb-3">
              <Lock className="w-6 h-6 text-th-text-sub" />
            </div>
            <h1 className="text-xl font-semibold text-th-text">File Manager</h1>
            <p className="text-sm text-th-text-dim mt-1">Enter your password to continue</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-th-text-sub mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-10 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-th-text-faint hover:text-th-text-sub transition"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-th-btn text-th-btn-text py-2.5 px-4 rounded-lg hover:bg-th-btn-hover disabled:bg-th-btn-disabled disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
