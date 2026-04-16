import { Plus } from 'lucide-react';
import { INTERVAL_PRESETS } from './types';

interface AddPlaylistFormProps {
  show: boolean;
  folders: string[];
  url: string;
  folder: string;
  format: 'video' | 'audio';
  interval: number;
  onUrlChange: (url: string) => void;
  onFolderChange: (folder: string) => void;
  onFormatChange: (format: 'video' | 'audio') => void;
  onIntervalChange: (hours: number) => void;
  onAdd: () => void;
  onToggleShow: () => void;
}

export default function AddPlaylistForm({
  show,
  folders,
  url,
  folder,
  format,
  interval,
  onUrlChange,
  onFolderChange,
  onFormatChange,
  onIntervalChange,
  onAdd,
  onToggleShow,
}: AddPlaylistFormProps) {
  if (!show) {
    return (
      <button
        onClick={onToggleShow}
        className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-th-border rounded-lg text-sm text-th-text-dim hover:text-th-text-sub hover:border-th-border-light transition"
      >
        <Plus className="w-4 h-4" />
        Add Playlist
      </button>
    );
  }

  return (
    <div className="mt-4 p-4 bg-th-bg rounded-lg border border-th-border-light space-y-3">
      <div>
        <label className="block text-sm font-medium text-th-text-sub mb-1">Playlist URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://www.youtube.com/playlist?list=..."
          className="w-full px-3 py-2 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text text-sm"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-th-text-sub mb-1">Folder</label>
          <select
            value={folder}
            onChange={(e) => onFolderChange(e.target.value)}
            className="w-full px-3 py-2 border border-th-border rounded-lg focus:ring-2 focus:ring-th-ring focus:border-transparent outline-none transition bg-th-bg text-th-text text-sm"
          >
            {folders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-th-text-sub mb-1">Format</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onFormatChange('video')}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition border ${
                format === 'video'
                  ? 'bg-th-btn text-th-btn-text border-th-btn'
                  : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
              }`}
            >
              Video
            </button>
            <button
              type="button"
              onClick={() => onFormatChange('audio')}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition border ${
                format === 'audio'
                  ? 'bg-th-btn text-th-btn-text border-th-btn'
                  : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
              }`}
            >
              Audio
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-th-text-faint">Sync every:</span>
        {INTERVAL_PRESETS.map((h) => (
          <button
            key={h}
            onClick={() => onIntervalChange(h)}
            className={`px-2 py-0.5 rounded-md text-xs font-medium transition border ${
              interval === h
                ? 'bg-th-btn text-th-btn-text border-th-btn'
                : 'bg-th-bg text-th-text-sub border-th-border-light hover:bg-th-bg-alt'
            }`}
          >
            {h}h
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onAdd}
          disabled={!url || !folder}
          className="px-4 py-1.5 text-sm bg-th-btn text-th-btn-text rounded-lg hover:bg-th-btn-hover disabled:bg-th-btn-disabled disabled:cursor-not-allowed transition"
        >
          Add
        </button>
        <button
          onClick={onToggleShow}
          className="px-4 py-1.5 text-sm text-th-text-sub hover:text-th-text transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
