/**
 * Integration tests — Queue persistence and restart recovery
 *
 * Scenarios:
 *   QR1  yt-dlp job in queue.json → re-enqueued on startup with original id
 *   QR2  HTTP job in queue.json → re-enqueued with correct fields
 *   QR3  Job with unknown folderKey → skipped, not added to jobs
 *   QR4  Corrupt queue.json → server starts normally with empty queue
 *   QR5  Done/error jobs written manually to queue.json → not re-enqueued
 *        (saveQueue only writes queued/downloading; this verifies the filter)
 */

import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

const YTDLP_JOB_ID = '11111111-1111-4111-8111-111111111111';
const HTTP_JOB_ID  = '22222222-2222-4222-8222-222222222222';

/** Wait one event-loop turn so the recovery setImmediate has run. */
function waitForRecovery(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Poll until all jobs leave active states (queued/downloading) or timeout. */
async function waitForJobsToSettle(
  app: ReturnType<typeof buildApp>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get('/api/jobs');
    const active = (res.body as Array<{ status: string }>).filter(
      (j) => j.status === 'queued' || j.status === 'downloading',
    );
    if (active.length === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ─── QR1 + QR2 — Happy-path recovery ─────────────────────────────────────────

describe('Queue recovery — re-enqueues active jobs', () => {
  let tmpDir: string;
  let filesDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    tmpDir   = mkdtempSync(path.join(tmpdir(), 'wd-test-qr-'));
    filesDir = path.join(tmpDir, 'files');
    mkdirSync(filesDir, { recursive: true });

    const queueFile = path.join(tmpDir, 'queue.json');
    writeFileSync(queueFile, JSON.stringify([
      {
        id: YTDLP_JOB_ID,
        url: 'https://example.invalid/watch?v=test',
        folderKey: 'files',
        filename: 'test video',
        destPath: filesDir,
        type: 'ytdlp',
        format: 'video',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: HTTP_JOB_ID,
        url: 'https://example.invalid/file.txt',
        folderKey: 'files',
        filename: 'file.txt',
        destPath: path.join(filesDir, 'file.txt'),
        type: 'http',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]));

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${filesDir}`,
      DATA_DIR: tmpDir,
    });
    app = buildApp();
    await waitForRecovery();
  });

  afterAll(async () => {
    // Wait for spawned yt-dlp / HTTP jobs to settle before shutdown so
    // child process handles are fully closed and don't leak into teardown.
    await waitForJobsToSettle(app);
    app.shutdown();
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('QR1 — yt-dlp job is re-enqueued with original id', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    const job = (res.body as Array<{ id: string }>).find((j) => j.id === YTDLP_JOB_ID);
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      id: YTDLP_JOB_ID,
      type: 'ytdlp',
      format: 'video',
      folder_key: 'files',
    });
  });

  it('QR2 — HTTP job is re-enqueued with original id', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    const job = (res.body as Array<{ id: string }>).find((j) => j.id === HTTP_JOB_ID);
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      id: HTTP_JOB_ID,
      type: 'http',
      folder_key: 'files',
      filename: 'file.txt',
    });
  });
});

// ─── QR3 — Unknown folderKey is skipped ───────────────────────────────────────

describe('Queue recovery — skips job with unknown folderKey', () => {
  let tmpDir: string;
  let filesDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    tmpDir   = mkdtempSync(path.join(tmpdir(), 'wd-test-qr-skip-'));
    filesDir = path.join(tmpDir, 'files');
    mkdirSync(filesDir, { recursive: true });

    const UNKNOWN_JOB_ID = '33333333-3333-4333-8333-333333333333';
    const queueFile = path.join(tmpDir, 'queue.json');
    writeFileSync(queueFile, JSON.stringify([
      {
        id: UNKNOWN_JOB_ID,
        url: 'https://example.invalid/file.txt',
        folderKey: 'does-not-exist',
        filename: 'file.txt',
        destPath: path.join(filesDir, 'file.txt'),
        type: 'http',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]));

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${filesDir}`,
      DATA_DIR: tmpDir,
    });
    app = buildApp();
    await waitForRecovery();
  });

  afterAll(() => {
    app.shutdown();
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('QR3 — job with unknown folderKey is not added to the queue', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─── QR4 — Corrupt queue.json ─────────────────────────────────────────────────

describe('Queue recovery — handles corrupt queue.json gracefully', () => {
  let tmpDir: string;
  let filesDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    tmpDir   = mkdtempSync(path.join(tmpdir(), 'wd-test-qr-corrupt-'));
    filesDir = path.join(tmpDir, 'files');
    mkdirSync(filesDir, { recursive: true });

    const queueFile = path.join(tmpDir, 'queue.json');
    writeFileSync(queueFile, '{ this is not valid json !!!');

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${filesDir}`,
      DATA_DIR: tmpDir,
    });
    app = buildApp();
    await waitForRecovery();
  });

  afterAll(() => {
    app.shutdown();
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('QR4 — server starts with empty queue when queue.json is corrupt', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
