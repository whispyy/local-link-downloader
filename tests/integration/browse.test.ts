/**
 * Integration tests — GET /api/browse/:folderKey and GET /api/browse/:folderKey/:filename
 *
 * Scenarios:
 *   B1  List files in a folder
 *   B2  List files with pagination
 *   B3  Serve a file (full request)
 *   B4  Serve a file with Range header (partial content)
 *   B5  404 for non-existent file
 *   B6  400 for invalid folder key
 *   B7  Path traversal blocked
 *   B8  Auth required when APP_PASSWORD is set
 *   B9  Empty folder returns empty list
 *   B10 Range request with invalid range returns 416
 */

import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

describe('GET /api/browse', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-browse-'));

    // Create test files
    writeFileSync(path.join(tmpDir, 'video.mp4'), 'fake-video-content');
    writeFileSync(path.join(tmpDir, 'image.png'), 'fake-png-content');
    writeFileSync(path.join(tmpDir, 'song.mp3'), 'fake-audio-content');
    writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello world');
    writeFileSync(path.join(tmpDir, 'data.bin'), 'binary-stuff');

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── List files ──────────────────────────────────────────────────────────────

  it('B1 — lists files in a folder', async () => {
    const res = await request(app).get('/api/browse/media');

    expect(res.status).toBe(200);
    expect(res.body.files).toBeInstanceOf(Array);
    expect(res.body.files.length).toBe(5);
    expect(res.body.total).toBe(5);

    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('video.mp4');
    expect(names).toContain('image.png');
    expect(names).toContain('song.mp3');

    // Each file should have name, size, modifiedAt
    const file = res.body.files[0];
    expect(file).toHaveProperty('name');
    expect(file).toHaveProperty('size');
    expect(file).toHaveProperty('modifiedAt');
  });

  it('B2 — pagination works', async () => {
    const res = await request(app).get('/api/browse/media?page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.files.length).toBe(2);
    expect(res.body.total).toBe(5);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);

    // Page 2
    const res2 = await request(app).get('/api/browse/media?page=2&limit=2');
    expect(res2.status).toBe(200);
    expect(res2.body.files.length).toBe(2);

    // Page 3 (last)
    const res3 = await request(app).get('/api/browse/media?page=3&limit=2');
    expect(res3.status).toBe(200);
    expect(res3.body.files.length).toBe(1);
  });

  it('B6 — invalid folder key returns 400', async () => {
    const res = await request(app).get('/api/browse/nonexistent');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid folder key/i);
  });

  it('B9 — empty folder returns empty list', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'wd-test-empty-'));
    setEnv({ DOWNLOAD_FOLDERS: `empty:${emptyDir}` });
    const emptyApp = buildApp();

    const res = await request(emptyApp).get('/api/browse/empty');

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
    expect(res.body.total).toBe(0);

    resetEnv();
    rmSync(emptyDir, { recursive: true, force: true });
  });

  // ── Serve file ──────────────────────────────────────────────────────────────

  it('B3 — serves a file (full request)', async () => {
    const res = await request(app)
      .get('/api/browse/media/readme.txt')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('hello world');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('B4 — serves a file with Range header (partial content)', async () => {
    const res = await request(app)
      .get('/api/browse/media/readme.txt')
      .set('Range', 'bytes=0-4')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe('hello');
    expect(res.headers['content-range']).toBe('bytes 0-4/11');
    expect(res.headers['content-length']).toBe('5');
  });

  it('B5 — 404 for non-existent file', async () => {
    const res = await request(app).get('/api/browse/media/nope.txt');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('B7 — path traversal is blocked', async () => {
    const res = await request(app).get('/api/browse/media/..%2F..%2Fetc%2Fpasswd');

    // sanitizeFilename strips .. and / so this either returns 400 or 404
    expect([400, 404]).toContain(res.status);
  });

  it('B10 — invalid range returns 416', async () => {
    const res = await request(app)
      .get('/api/browse/media/readme.txt')
      .set('Range', 'bytes=100-200');

    expect(res.status).toBe(416);
  });

  it('serves media files with correct content type', async () => {
    const res = await request(app).get('/api/browse/media/video.mp4');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');

    const res2 = await request(app).get('/api/browse/media/image.png');
    expect(res2.status).toBe(200);
    expect(res2.headers['content-type']).toBe('image/png');

    const res3 = await request(app).get('/api/browse/media/song.mp3');
    expect(res3.status).toBe(200);
    expect(res3.headers['content-type']).toBe('audio/mpeg');
  });
});

describe('GET /api/browse — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-browse-auth-'));
    writeFileSync(path.join(tmpDir, 'test.txt'), 'auth test');

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B8 — listing requires auth', async () => {
    const res = await request(app).get('/api/browse/files');
    expect(res.status).toBe(401);
  });

  it('B8 — serving requires auth', async () => {
    const res = await request(app).get('/api/browse/files/test.txt');
    expect(res.status).toBe(401);
  });

  it('B8 — serving accepts token via query param', async () => {
    // Login first
    const loginRes = await request(app)
      .post('/api/auth')
      .send({ password: 'secret123' });
    const token = loginRes.body.token;

    const res = await request(app)
      .get(`/api/browse/files/test.txt?token=${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('auth test');
  });

  it('B8 — listing works with Bearer token', async () => {
    const loginRes = await request(app)
      .post('/api/auth')
      .send({ password: 'secret123' });
    const token = loginRes.body.token;

    const res = await request(app)
      .get('/api/browse/files')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toBeInstanceOf(Array);
  });
});
