/**
 * Integration tests — GET /api/jobs
 *
 * Scenarios:
 *   J1  No auth header when auth is enabled → 401
 *   J2  Returns array sorted by created_at descending
 *   J3  Each job has the required shape fields
 */

import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

// ─── J1 — Unauthorized ────────────────────────────────────────────────────────
describe('GET /api/jobs — auth required', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    setEnv({ APP_PASSWORD: 'secret', DOWNLOAD_FOLDERS: 'f:/tmp' });
    app = buildApp();
  });

  afterAll(() => resetEnv());

  it('J1 — missing Authorization header returns 401', async () => {
    const res = await request(app).get('/api/jobs');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

// ─── J2 & J3 — Auth disabled ─────────────────────────────────────────────────
describe('GET /api/jobs — shape and ordering', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-jobs-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
      ALLOWED_EXTENSIONS: undefined,
    });
    app = buildApp();

    // Seed two upload jobs so the list is non-empty and ordering is testable.
    // We use /api/upload (synchronous) to avoid timing issues.
    await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('first'), 'first.txt');

    // Small delay to ensure different createdAt timestamps
    await new Promise((r) => setTimeout(r, 10));

    await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('second'), 'second.txt');
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('J2 — jobs are sorted by created_at descending', async () => {
    const res = await request(app).get('/api/jobs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const timestamps = (res.body as Array<{ created_at: string }>).map(
      (j) => new Date(j.created_at).getTime(),
    );
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });

  it('J3 — each job has the required shape fields', async () => {
    const res = await request(app).get('/api/jobs');

    expect(res.status).toBe(200);
    for (const job of res.body as Record<string, unknown>[]) {
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('url');
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('filename');
      expect(job).toHaveProperty('folder_key');
      expect(job).toHaveProperty('created_at');
      expect(job).toHaveProperty('updated_at');
    }
  });
});
