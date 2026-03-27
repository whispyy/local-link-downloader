/**
 * Integration tests — GET /api/config
 *
 * Scenarios:
 *   C1  No auth header when auth is enabled → 401
 *   C2  Valid token, folders + extensions configured → 200 with correct arrays
 *   C3  DOWNLOAD_FOLDERS not set → folders: []
 *   C4  freeSpace returned for existing folders
 *   C5  freeSpace omits folders that don't exist
 */

import { rmSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import request from 'supertest';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

// ─── C1 — Unauthorized ────────────────────────────────────────────────────────
describe('GET /api/config — auth required', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    setEnv({
      APP_PASSWORD: 'secret',
      DOWNLOAD_FOLDERS: 'images:/tmp/images',
      ALLOWED_EXTENSIONS: '.jpg,.png',
    });
    app = buildApp();
  });

  afterAll(() => resetEnv());

  it('C1 — missing Authorization header returns 401', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

// ─── C2 & C3 — Auth disabled (simpler to test config shape) ──────────────────
describe('GET /api/config — auth disabled', () => {
  afterEach(() => resetEnv());

  it('C2 — returns folders and allowedExtensions arrays when configured', async () => {
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: 'images:/tmp/images;videos:/tmp/videos',
      ALLOWED_EXTENSIONS: '.jpg,.png,.mp4',
    });
    const app = buildApp();

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual(['images', 'videos']);
    expect(res.body.allowedExtensions).toEqual(['.jpg', '.png', '.mp4']);
  });

  it('C3 — DOWNLOAD_FOLDERS not set → folders is empty array', async () => {
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: undefined,
      ALLOWED_EXTENSIONS: undefined,
    });
    const app = buildApp();

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual([]);
    expect(res.body.allowedExtensions).toEqual([]);
  });

  it('C4 — freeSpace returned for existing folders', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'config-test-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `tmp:${tmpDir}`,
      ALLOWED_EXTENSIONS: undefined,
    });
    const app = buildApp();

    try {
      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.freeSpace).toBeDefined();
      expect(typeof res.body.freeSpace.tmp).toBe('number');
      expect(res.body.freeSpace.tmp).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('C5 — freeSpace omits folders that do not exist', async () => {
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: 'ghost:/tmp/does-not-exist-' + Date.now(),
      ALLOWED_EXTENSIONS: undefined,
    });
    const app = buildApp();

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.freeSpace).toBeDefined();
    expect(res.body.freeSpace.ghost).toBeUndefined();
  });
});
