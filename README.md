# Link Downloader

[![Docker Image](https://img.shields.io/badge/ghcr.io-latest-blue?logo=docker)](https://github.com/whispyy/local-link-downloader/pkgs/container/local-link-downloader)

A self-hosted web UI for downloading files from URLs, uploading local files, pulling torrents, or downloading YouTube videos/playlists — all saved to folders on your machine.

- **Frontend** — React + Vite + Tailwind CSS
- **Backend** — Express (TypeScript), runs on Node.js
- **Browse page** — `#/browse` — browse downloaded files with media preview (video, audio, image, text)
- **Queue page** — `#/queue` — live job list with status filter, progress display, and stop button
- **Playlists page** — `#/playlists` — manage YouTube playlist syncs with per-video status tracking and retry
- **Auto-clean page** — `#/autoclean` — configure per-folder retention policies to auto-delete old files

**Published image:** `ghcr.io/whispyy/local-link-downloader:latest`

---

## Features

| Feature | Details |
|---------|---------|
| **Download from URL** | Paste any HTTP/HTTPS URL; the server fetches the file server-side |
| **Upload from local file** | Drag-and-drop or browse to upload a file directly from your browser; optionally generate a thumbnail for image files |
| **Torrent download** | Paste a magnet link or drop a `.torrent` file; downloads via BitTorrent with live peer count and speed |
| **YouTube download** | Paste a YouTube video URL; downloads video (MP4) or audio (MP3) via yt-dlp with live progress bar and title resolution |
| **Playlist sync** | Add YouTube playlists that sync automatically on a schedule. Per-video status tracking (done/failed/cancelled/downloading) with manual retry for failed items |
| **Auto-clean** | Per-folder retention policies — automatically delete files older than a configured number of days |
| **Download progress** | Live progress bar with bytes downloaded / total size and percentage (HTTP, torrent, and yt-dlp) |
| **Cancel / stop** | Cancel a queued or in-progress download (including torrents and yt-dlp jobs) from the main UI or the Queue page. Partial files are cleaned up on cancel |
| **Multiple destination folders** | Configure any number of named folders via `DOWNLOAD_FOLDERS` |
| **Extension allow-list** | Optionally restrict which file extensions are accepted (HTTP/upload only — does not apply to torrents or yt-dlp) |
| **Optional password auth** | Set `APP_PASSWORD` to require a password; sessions last 8 hours |
| **Browse files** | `#/browse` page lists files in each folder with size, date, media preview (video/audio/image/text), direct download, delete, and inline thumbnail preview for images uploaded with thumbnail generation enabled |
| **Queue job list** | `#/queue` page shows all jobs (queued, downloading, done, error, cancelled) with live auto-refresh |
| **Discord notifications** | Optional webhook — get notified on download/upload/torrent/yt-dlp start and completion |
| **PWA update prompt** | When a new version is deployed, an "Update available" button appears |
| **Persistent logs** | Every download/upload/torrent is appended to `logs/downloads.log` |

---

## Using the Pre-built Image (Recommended for home-automation)

No need to clone this repo or build anything. Pull the image directly:

```bash
docker pull ghcr.io/whispyy/local-link-downloader:latest
```

Or reference it in another project's `docker-compose.yml`:

```yaml
services:
  web-downloader:
    image: ghcr.io/whispyy/local-link-downloader:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DOWNLOAD_FOLDERS: "images:/downloads/images;videos:/downloads/videos"
      ALLOWED_EXTENSIONS: ".jpg,.png,.gif,.zip,.mp4,.pdf"
      APP_PASSWORD: "your_secret_password"
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/..."
    volumes:
      - /mnt/nas/images:/downloads/images
      - /mnt/nas/videos:/downloads/videos
      - ./logs/web-downloader:/app/logs
      - ./data/web-downloader:/app/data    # persists auto-clean rules and playlist config
```

To update to the latest version:

```bash
docker compose pull web-downloader && docker compose up -d web-downloader
```

---

## CI/CD — Automatic Image Publishing

The workflow at [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) runs on every push to `main` and on version tags (`v*.*.*`).

It publishes the following tags to GHCR:

| Tag | When |
|-----|------|
| `latest` | Every push to `main` |
| `v1.2.3` | On a `v1.2.3` git tag |
| `v1.2` | On a `v1.2.x` git tag |
| `sha-abc1234` | Every build (short commit SHA) |

No secrets need to be configured — the workflow uses the built-in `GITHUB_TOKEN`.

---

## Quick Start (Development)

```bash
cp .env.example .env
# Edit .env with your folder paths and settings
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:5173` and proxies `/api/*` to the Express server on port `3001`.

---

## Docker Deployment

### 1. Build and run with Docker Compose

```bash
docker compose up -d --build
```

The app will be available at `http://localhost:3000`.

### 2. Mapping host folders into the container

Files are downloaded **inside the container** to paths defined in `DOWNLOAD_FOLDERS`. To have those files land on your **host machine**, you bind-mount host directories to the container paths.

**The key principle:**

```
DOWNLOAD_FOLDERS=<key>:<container-path>
volumes:
  - /your/host/path:<container-path>
```

The `<container-path>` is the bridge — it must match on both sides.

#### Example

You want downloads to land in `/mnt/nas/images` on your host:

```yaml
# docker-compose.yml
environment:
  DOWNLOAD_FOLDERS: "images:/downloads/images;videos:/downloads/videos"
volumes:
  - /mnt/nas/images:/downloads/images
  - /mnt/nas/videos:/downloads/videos
```

When the app downloads a file to `/downloads/images/photo.jpg` inside the container, it appears at `/mnt/nas/images/photo.jpg` on your host.

### 3. Customising the compose file

Edit `docker-compose.yml` and adjust:

| Section | What to change |
|---------|---------------|
| `DOWNLOAD_FOLDERS` | Add/rename folder keys and their container-side paths |
| `ALLOWED_EXTENSIONS` | Comma-separated list of permitted file extensions |
| `MAX_UPLOAD_SIZE` | Maximum size for direct browser uploads (default `10gb`) |
| `volumes` | Map each container path to the real host path; also mount `data/` for persistent config |
| `ports` | Change `3000:3000` if port 3000 is already in use |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3001` (dev) / `3000` (Docker) | Port the Express server listens on |
| `DOWNLOAD_FOLDERS` | _(none)_ | Semicolon-separated `key:/path` pairs, e.g. `images:/mnt/images;tmp:/mnt/tmp` |
| `ALLOWED_EXTENSIONS` | _(none — all allowed)_ | Comma-separated extensions, e.g. `.jpg,.png,.mp4` |
| `MAX_UPLOAD_SIZE` | `10gb` | Maximum file size for direct browser uploads. Accepts `b`, `kb`, `mb`, `gb` units |
| `LOG_DIR` | `./logs` | Directory where `downloads.log` is written |
| `APP_PASSWORD` | _(unset — auth disabled)_ | When set, a password prompt is shown on every new browser session. Sessions last 8 hours. |
| `DISCORD_WEBHOOK_URL` | _(unset — disabled)_ | Discord webhook URL. When set, sends notifications on download/upload/torrent start and completion |
| `DATA_DIR` | `./data` | Directory for persistent config files (`playlists.json`, `auto-clean.json`). Mount as a volume in Docker to preserve settings across restarts |
| `STATIC_DIR` | _(empty)_ | When set, Express serves the built frontend from this path (set automatically in Docker) |

---

## Project Structure

```
├── src/                  # React frontend
│   ├── pages/
│   │   ├── App.tsx           # Main downloader UI (URL, upload, torrent, YouTube tabs)
│   │   ├── QueuePage.tsx     # /queue job list page
│   │   ├── BrowsePage.tsx    # /browse file browser with media preview
│   │   ├── PlaylistsPage.tsx # /playlists YouTube playlist management
│   │   ├── AutoCleanPage.tsx # /autoclean per-folder retention rules
│   │   ├── LoginPage.tsx     # Password prompt (when APP_PASSWORD is set)
│   │   └── UsagePage.tsx     # /usage disk usage overview
│   ├── components/
│   │   ├── playlists/        # PlaylistCard, PlaylistVideoList, AddPlaylistForm, types
│   │   ├── NavBar.tsx
│   │   └── ...
│   └── main.tsx              # Hash-based router
├── server/
│   ├── app.ts            # Express app factory — all API endpoints and business logic
│   ├── ytdlp.ts          # yt-dlp integration: downloads, playlist sync, progress parsing
│   ├── autoclean.ts      # Auto-clean: per-folder retention policy engine
│   ├── transcode.ts      # Media transcoding and streaming
│   └── index.ts          # Entry point — loads .env and starts the server
├── data/                 # Persistent config (auto-clean.json, playlists.json)
├── Dockerfile            # Multi-stage build (includes ffmpeg + yt-dlp)
├── docker-compose.yml    # Compose with volume mounts
├── .env.example          # Environment variable template
└── tsconfig.server.build.json  # TypeScript config for production server build
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth` | Exchange password for a session token (`{ password }`) |
| `GET` | `/api/config` | Returns configured folder keys and allowed extensions |
| `POST` | `/api/download` | Start a URL download job (`{ url, folderKey, filenameOverride? }`) |
| `POST` | `/api/upload` | Upload a file directly from the browser (`multipart/form-data`: `file`, `folderKey`, `filenameOverride?`, `thumbnail?`). Pass `thumbnail=on` to generate a 320×320 JPEG thumbnail for raster images (JPEG, PNG, GIF, WebP, BMP). Response includes `has_thumbnail: true` when generated. |
| `POST` | `/api/torrent` | Start a torrent — JSON `{ magnet, folderKey }` for magnet links, or `multipart/form-data` with a `torrent` file and `folderKey` |
| `GET` | `/api/jobs` | List all jobs, sorted newest first |
| `GET` | `/api/status/:jobId` | Get status of a specific job (includes `downloaded_bytes`, `total_bytes`, `peers`, `download_speed` for torrents) |
| `GET` | `/api/browse/:folderKey` | List files in a folder (paginated: `?page=1&limit=50`), returns `{ files, total }` |
| `GET` | `/api/browse/:folderKey/:filename` | Serve/download a file (pass `?token=` for auth) |
| `DELETE` | `/api/browse/:folderKey/:filename` | Delete a file from a folder |
| `DELETE` | `/api/jobs/:jobId` | Cancel a queued or in-progress job; removes partial files for HTTP/yt-dlp downloads, stops the torrent for torrent jobs |
| `POST` | `/api/ytdlp` | Start a YouTube download via yt-dlp (`{ url, folderKey, format }` where format is `"video"` or `"audio"`) |
| `GET` | `/api/playlists` | List all configured playlists and available folder keys |
| `PUT` | `/api/playlists` | Save/update playlists (`{ playlists: [...] }`) — server merges video statuses to prevent stale overwrites |
| `POST` | `/api/playlists/sync` | Trigger a playlist sync (`{ playlistId }` for one, or `{}` for all) |
| `GET` | `/api/playlists/:id/videos` | List all videos in a playlist with status and live download progress |
| `POST` | `/api/playlists/:id/retry` | Retry failed/cancelled videos (`{ videoIds }` for specific, or `{}` for all failed) |
| `GET` | `/api/auto-clean` | Get current auto-clean retention rules |
| `PUT` | `/api/auto-clean` | Save auto-clean rules (`{ rules: [...] }`) |

All endpoints except `POST /api/auth` require a `Authorization: Bearer <token>` header when `APP_PASSWORD` is set.

---

## Notes

- **Jobs are in-memory only.** They are lost when the container/server restarts. Downloaded files and `logs/downloads.log` persist via volume mounts. Jobs are automatically evicted from memory after 24 hours.
- **Logs** are written to `LOG_DIR/downloads.log`. Mount `./logs:/app/logs` in Docker to keep them on the host.
- **Cancellation** aborts the in-flight HTTP fetch and deletes any partial file on disk. For yt-dlp jobs, partial and temp files are cleaned up. For torrent jobs, the torrent is stopped but partially-downloaded files are kept.
- **Upload size limit** is enforced server-side by `MAX_UPLOAD_SIZE` (default `10gb`). Multer rejects oversized uploads before they are written to disk.
- **Thumbnails** are generated on upload when the "Generate thumbnail" checkbox is checked and the file is a raster image (JPEG, PNG, GIF, WebP, BMP). They are saved to a `.thumbnails/` subfolder inside the destination directory (same filename, JPEG format, max 320×320 px). The `.thumbnails/` folder is hidden from the browse UI. Thumbnail generation failure is non-fatal — the upload still succeeds.
- **Torrents** are downloaded to a subfolder named after the torrent inside the chosen destination folder. Multi-file torrents are fully supported. The extension allow-list (`ALLOWED_EXTENSIONS`) does not apply to torrent jobs.
- **Torrent client** is initialised lazily on the first torrent request and shared across all jobs. It binds to a random UDP port for BitTorrent traffic — make sure your firewall/router allows outbound UDP if you are behind NAT.
- **yt-dlp** is bundled in the Docker image. Video downloads use `bv[ext=mp4]+ba[ext=m4a]` format selection with MP4 merge; audio downloads extract to MP3. Video titles are resolved before download and displayed in the queue.
- **Playlist sync** runs on a configurable interval (1–24 hours). Video statuses (`done`, `failed`, `cancelled`, `downloading`) are persisted to `data/playlists.json`. Failed or cancelled videos are not auto-retried — use the retry button in the UI or the `POST /api/playlists/:id/retry` endpoint.
- **Pre-seeding playlists** — place a `data/playlists.json` file in the data volume before first boot to pre-configure playlists. The server picks it up on startup and begins syncing after 10 seconds.
- **Auto-clean** rules are persisted to `data/auto-clean.json`. Each rule specifies a folder key and a retention period in days. Files older than the retention period are deleted automatically on a schedule.
- The server blocks HTTP and yt-dlp downloads to internal/private IP ranges to prevent SSRF. Redirects are followed — see security notes in the code if you need stricter controls.
