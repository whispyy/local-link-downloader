export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export type MediaType = 'video' | 'audio' | 'image' | 'text' | null;

const MEDIA_EXTENSIONS: Record<string, MediaType> = {
  '.mp4': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.avi': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.bmp': 'image',
  '.txt': 'text',
  '.md': 'text',
  '.csv': 'text',
  '.log': 'text',
  '.json': 'text',
  '.xml': 'text',
  '.yaml': 'text',
  '.yml': 'text',
  '.ini': 'text',
  '.conf': 'text',
  '.cfg': 'text',
  '.sh': 'text',
  '.bash': 'text',
  '.zsh': 'text',
  '.py': 'text',
  '.js': 'text',
  '.ts': 'text',
  '.html': 'text',
  '.css': 'text',
  '.env': 'text',
  '.toml': 'text',
  '.nfo': 'text',
  '.srt': 'text',
  '.sub': 'text',
  '.ass': 'text',
};

export function getMediaType(filename: string): MediaType {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filename.substring(dot).toLowerCase();
  return MEDIA_EXTENSIONS[ext] ?? null;
}

/** Containers that browsers can't play natively and need server-side remux */
const NEEDS_STREAM = new Set(['.mkv', '.avi', '.wmv', '.flv', '.m2ts']);

export function needsStreamEndpoint(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return NEEDS_STREAM.has(filename.substring(dot).toLowerCase());
}
