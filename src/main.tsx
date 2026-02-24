import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AdminPage from './AdminPage.tsx';
import LoginPage from './LoginPage.tsx';
import './index.css';

const SESSION_KEY = 'wd_token';

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));
  const [authChecked, setAuthChecked] = useState(false);

  // On mount, verify whether auth is required by calling /api/auth with no body.
  // If auth is disabled server-side, the server returns a dummy token immediately.
  useEffect(() => {
    if (token) {
      // We already have a token from this session — trust it until a 401 proves otherwise
      setAuthChecked(true);
      return;
    }

    // Try a no-password auth to detect if auth is disabled
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.token === 'no-auth') {
          // Auth is disabled — store the dummy token and proceed
          sessionStorage.setItem(SESSION_KEY, 'no-auth');
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
    sessionStorage.setItem(SESSION_KEY, newToken);
    setToken(newToken);
  };

  const handleUnauthorized = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken(null);
  };

  if (!authChecked) {
    // Brief loading state while we probe the server
    return null;
  }

  if (!token) {
    return <LoginPage onSuccess={handleLogin} />;
  }

  const authEnabled = token !== 'no-auth';

  if (hash === '#/admin') {
    return <AdminPage token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} />;
  }

  return <App token={token} onUnauthorized={handleUnauthorized} authEnabled={authEnabled} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
