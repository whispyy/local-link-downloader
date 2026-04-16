import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import App from './pages/App.tsx';
import QueuePage from './pages/QueuePage.tsx';
import BrowsePage from './pages/BrowsePage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import UsagePage from './pages/UsagePage.tsx';
import AutoCleanPage from './pages/AutoCleanPage.tsx';
import PlaylistsPage from './pages/PlaylistsPage.tsx';
import VersionBadge from './components/VersionBadge.tsx';
import './index.css';

const SESSION_KEY = 'wd_token';

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [authChecked, setAuthChecked] = useState(false);

  // On mount, probe whether auth is required via GET /api/config (no auth headers).
  // 200 → auth disabled; 401 → auth required. Avoids burning a rate-limit slot.
  useEffect(() => {
    if (token) {
      // We already have a token from this session — trust it until a 401 proves otherwise
      setAuthChecked(true);
      return;
    }

    // Probe auth requirement via GET /api/config (no rate-limit cost).
    // 200 → auth disabled; 401 → auth required; other/error → show login.
    fetch('/api/config')
      .then((res) => {
        if (res.ok) {
          localStorage.setItem(SESSION_KEY, 'no-auth');
          setToken('no-auth');
        }
      })
      .catch(() => {
        // Server unreachable — show login page anyway
      })
      .finally(() => setAuthChecked(true));
  }, [token]);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleLogin = (newToken: string) => {
    localStorage.setItem(SESSION_KEY, newToken);
    setToken(newToken);
  };

  const handleUnauthorized = () => {
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
  };

  if (!authChecked) {
    // Brief loading state while we probe the server
    return null;
  }

  if (!token) {
    return <><LoginPage onSuccess={handleLogin} /><VersionBadge /></>;
  }

  const authEnabled = token !== 'no-auth';

  if (hash === '#/queue') {
    return <><QueuePage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
  }

  if (hash === '#/browse') {
    return <><BrowsePage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
  }

  if (hash === '#/usage') {
    return <><UsagePage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
  }

  if (hash === '#/settings') {
    window.location.hash = '#/autoclean';
    return null;
  }

  if (hash === '#/autoclean') {
    return <><AutoCleanPage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
  }

  if (hash === '#/playlists') {
    return <><PlaylistsPage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
  }

  return <><App token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} /><VersionBadge /></>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>
);
