import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  render() {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#e2e8f0', padding: 24, fontFamily: 'monospace' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ color: '#f87171', fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>
            Please take a screenshot of this page and send it to the admin.
          </p>

          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#f87171', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Error</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, color: '#fbbf24', margin: 0 }}>
              {error.toString()}
            </pre>
          </div>

          {errorInfo?.componentStack && (
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Component Stack</p>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, color: '#cbd5e1', margin: 0 }}>
                {errorInfo.componentStack}
              </pre>
            </div>
          )}

          {error.stack && (
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Stack Trace</p>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, color: '#cbd5e1', margin: 0 }}>
                {error.stack}
              </pre>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 20px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              Reload Page
            </button>
            <button
              onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.hash = ''; window.location.reload(); }}
              style={{ padding: '8px 20px', backgroundColor: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              Clear Cache &amp; Reload
            </button>
          </div>

          <p style={{ color: '#64748b', fontSize: 11, marginTop: 24 }}>
            {navigator.userAgent}
          </p>
        </div>
      </div>
    );
  }
}
