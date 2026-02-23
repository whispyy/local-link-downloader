# Web Downloader

A self-hosted web UI for downloading files from URLs to folders on your machine.

- **Frontend** — React + Vite + Tailwind CSS
- **Backend** — Express (TypeScript), runs on Node.js
- **Admin page** — `/admin` (hash route `#/admin`) — live job list with status filter

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
| `volumes` | Map each container path to the real host path |
| `ports` | Change `3000:3000` if port 3000 is already in use |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3001` (dev) / `3000` (Docker) | Port the Express server listens on |
| `DOWNLOAD_FOLDERS` | _(none)_ | Semicolon-separated `key:/path` pairs, e.g. `images:/mnt/images;tmp:/mnt/tmp` |
| `ALLOWED_EXTENSIONS` | _(none — all allowed)_ | Comma-separated extensions, e.g. `.jpg,.png,.mp4` |
| `LOG_DIR` | `./logs` | Directory where `downloads.log` is written |
| `STATIC_DIR` | _(empty)_ | When set, Express serves the built frontend from this path (set automatically in Docker) |

---

## Project Structure

```
├── src/                  # React frontend
│   ├── App.tsx           # Main downloader UI
│   ├── AdminPage.tsx     # /admin job list page
│   └── main.tsx          # Hash-based router
├── server/
│   └── index.ts          # Express API server
├── Dockerfile            # Multi-stage build
├── docker-compose.yml    # Compose with volume mounts
├── .env.example          # Environment variable template
└── tsconfig.server.build.json  # TypeScript config for production server build
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Returns configured folder keys and allowed extensions |
| `POST` | `/api/download` | Start a download job (`{ url, folderKey, filenameOverride? }`) |
| `GET` | `/api/status/:jobId` | Get status of a specific job |
| `GET` | `/api/jobs` | List all jobs, sorted newest first |

---

## Notes

- **Jobs are in-memory only.** They are lost when the container/server restarts. The downloaded files and `logs/downloads.log` persist via volume mounts.
- **Logs** are written to `LOG_DIR/downloads.log`. Mount `./logs:/app/logs` in Docker to keep them on the host.
- The server blocks downloads to internal/private IP ranges to prevent SSRF. Redirects are followed — see security notes in the code if you need stricter controls.
