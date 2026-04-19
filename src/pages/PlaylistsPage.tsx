import { useState, useEffect } from 'react';
import { useAuthHeaders } from '../hooks/useAuthHeaders';
import { Loader2, Save, CheckCircle, RefreshCw, ListVideo } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import NavBar from '../components/NavBar';
import PlaylistCard from '../components/playlists/PlaylistCard';
import AddPlaylistForm from '../components/playlists/AddPlaylistForm';
import type { Playlist, PlaylistVideo } from '../components/playlists/types';

interface PlaylistsPageProps {
  token: string;
  onUnauthorized: () => void;
  authEnabled: boolean;
}

export default function PlaylistsPage({ token, onUnauthorized, authEnabled }: PlaylistsPageProps) {
  const headers = useAuthHeaders(token);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New playlist form
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [newFormat, setNewFormat] = useState<'video' | 'audio'>('video');
  const [newInterval, setNewInterval] = useState(6);

  // Expanded playlist detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videos, setVideos] = useState<PlaylistVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/playlists', { headers })
      .then((res) => {
        if (res.status === 401) { onUnauthorized(); return null; }
        if (!res.ok) throw new Error('Failed to load playlists');
        return res.json();
      })
      .then((data: { playlists: Playlist[]; folders: string[] } | null) => {
        if (!data) return;
        setFolders(data.folders);
        setPlaylists(data.playlists);
        if (data.folders.length > 0 && !newFolder) setNewFolder(data.folders[0]);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToServer = async (updatedPlaylists: Playlist[]): Promise<boolean> => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/playlists', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlists: updatedPlaylists }),
      });
      if (res.status === 401) { onUnauthorized(); return false; }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setSuccess('Saved');
      setTimeout(() => setSuccess(''), 3000);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => saveToServer(playlists);

  const handleAdd = async () => {
    if (!newUrl || !newFolder) return;
    const pl: Playlist = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      url: newUrl,
      folderKey: newFolder,
      format: newFormat,
      enabled: true,
      syncIntervalHours: newInterval,
      videoStatuses: {},
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date().toISOString(),
    };
    const prev = playlists;
    const updated = [...playlists, pl];
    setPlaylists(updated);
    setNewUrl('');
    setNewFormat('video');
    setNewInterval(6);
    setShowAdd(false);
    const ok = await saveToServer(updated);
    if (!ok) setPlaylists(prev);
  };

  const handleRemove = async (id: string) => {
    const prev = playlists;
    const updated = playlists.filter((p) => p.id !== id);
    setPlaylists(updated);
    if (expandedId === id) setExpandedId(null);
    const ok = await saveToServer(updated);
    if (!ok) setPlaylists(prev);
  };

  const handleToggle = async (id: string) => {
    const prev = playlists;
    const updated = playlists.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p);
    setPlaylists(updated);
    const ok = await saveToServer(updated);
    if (!ok) setPlaylists(prev);
  };

  const handleIntervalChange = (id: string, hours: number) => {
    setPlaylists((prev) => prev.map((p) => p.id === id ? { ...p, syncIntervalHours: hours } : p));
  };

  const handleSync = async (playlistId?: string) => {
    setSyncing(playlistId || 'all');
    setError('');
    try {
      const res = await fetch('/api/playlists/sync', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(playlistId ? { playlistId } : {}),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      if (data.playlists) setPlaylists(data.playlists);
      if (expandedId) fetchVideos(expandedId);
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(null);
    }
  };

  const fetchVideos = async (playlistId: string) => {
    setLoadingVideos(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/videos`, { headers });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error('Failed to load videos');
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingVideos(false);
    }
  };

  const toggleExpand = (playlistId: string) => {
    if (expandedId === playlistId) {
      setExpandedId(null);
      setVideos([]);
    } else {
      setExpandedId(playlistId);
      fetchVideos(playlistId);
    }
  };

  const handleRetry = async (playlistId: string, videoIds?: string[]) => {
    setRetrying(videoIds?.[0] || 'all');
    setError('');
    try {
      const res = await fetch(`/api/playlists/${playlistId}/retry`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(videoIds ? { videoIds } : {}),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      if (data.playlists) setPlaylists(data.playlists);
      fetchVideos(playlistId);
    } catch (err) {
      setError(String(err));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-th-grad-from to-th-grad-to">
      <NavBar currentPage="playlists" authEnabled={authEnabled} onSignOut={onUnauthorized} />

      <div className="p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <PageTitle icon={ListVideo} title="Playlists">
            {!loading && (
              <div className="flex items-center gap-2 ml-auto">
                {success && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4" /> {success}
                  </span>
                )}
                <button
                  onClick={() => handleSync()}
                  disabled={syncing !== null || playlists.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-th-bg border border-th-border-light rounded-lg
                             hover:bg-th-bg-alt disabled:opacity-50 disabled:cursor-not-allowed transition text-th-text-sub whitespace-nowrap"
                >
                  {syncing === 'all'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Sync All
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-th-btn text-th-btn-text rounded-lg
                             hover:bg-th-btn-hover disabled:bg-th-btn-disabled disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            )}
          </PageTitle>

          <p className="text-sm text-th-text-sub -mt-4 mb-5">
            Sync YouTube playlists automatically. New videos are downloaded on a schedule.
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

          {!loading && (
            <>
              {playlists.length === 0 && !showAdd && (
                <div className="py-12 text-center text-th-text-faint text-sm">
                  No playlists configured yet.
                </div>
              )}

              <div className="space-y-3">
                {playlists.map((pl) => (
                  <PlaylistCard
                    key={pl.id}
                    playlist={pl}
                    isExpanded={expandedId === pl.id}
                    videos={expandedId === pl.id ? videos : []}
                    loadingVideos={expandedId === pl.id && loadingVideos}
                    syncing={syncing === pl.id}
                    retrying={expandedId === pl.id ? retrying : null}
                    onToggle={() => handleToggle(pl.id)}
                    onRemove={() => handleRemove(pl.id)}
                    onExpand={() => toggleExpand(pl.id)}
                    onSync={() => handleSync(pl.id)}
                    onRetry={(videoIds) => handleRetry(pl.id, videoIds)}
                    onIntervalChange={(h) => handleIntervalChange(pl.id, h)}
                  />
                ))}
              </div>

              <AddPlaylistForm
                show={showAdd}
                folders={folders}
                url={newUrl}
                folder={newFolder}
                format={newFormat}
                interval={newInterval}
                onUrlChange={setNewUrl}
                onFolderChange={setNewFolder}
                onFormatChange={setNewFormat}
                onIntervalChange={setNewInterval}
                onAdd={handleAdd}
                onToggleShow={() => setShowAdd(!showAdd)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
