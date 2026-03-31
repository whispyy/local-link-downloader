/**
 * Integration tests — GET /api/browse/:folderKey and GET /api/browse/:folderKey/:filename
 *                      DELETE /api/browse/:folderKey/:filename
 *                      POST /api/browse/:folderKey/:filename/move
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
 *   B11 Delete a file
 *   B12 Delete non-existent file returns 404
 *   B13 Delete with invalid folder key returns 400
 *   B14 Delete with path traversal blocked
 *   B15 Delete requires auth when APP_PASSWORD is set
 *   B16 Delete a file with special characters in name
 *   B17 Move a file to another folder
 *   B18 Move returns 400 for missing targetFolder
 *   B19 Move returns 400 for same source and target folder
 *   B20 Move returns 400 for invalid source folder key
 *   B21 Move returns 400 for invalid target folder key
 *   B22 Move returns 404 for non-existent file
 *   B23 Move returns 409 when file already exists in target
 *   B24 Move blocks path traversal
 *   B25 Move requires auth when APP_PASSWORD is set
 */

import request from 'supertest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
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

describe('DELETE /api/browse/:folderKey/:filename', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-delete-'));

    writeFileSync(path.join(tmpDir, 'deleteme.txt'), 'goodbye');
    writeFileSync(path.join(tmpDir, 'keep.txt'), 'stay');
    writeFileSync(path.join(tmpDir, 'file with spaces.txt'), 'spaced');
    writeFileSync(path.join(tmpDir, 'café.txt'), 'accented');

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterEach(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B11 — deletes a file and removes it from disk', async () => {
    const res = await request(app).delete('/api/browse/media/deleteme.txt');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'deleteme.txt'))).toBe(false);

    // Other files are untouched
    expect(existsSync(path.join(tmpDir, 'keep.txt'))).toBe(true);

    // File no longer appears in listing
    const list = await request(app).get('/api/browse/media');
    const names = list.body.files.map((f: { name: string }) => f.name);
    expect(names).not.toContain('deleteme.txt');
    expect(names).toContain('keep.txt');
  });

  it('B12 — returns 404 for non-existent file', async () => {
    const res = await request(app).delete('/api/browse/media/nope.txt');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('B13 — returns 400 for invalid folder key', async () => {
    const res = await request(app).delete('/api/browse/nonexistent/deleteme.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid folder key/i);
  });

  it('B14 — blocks path traversal', async () => {
    const res = await request(app).delete('/api/browse/media/..%2F..%2Fetc%2Fpasswd');

    expect([400, 404]).toContain(res.status);
  });

  it('B16 — deletes a file with spaces in name', async () => {
    const res = await request(app).delete('/api/browse/media/file%20with%20spaces.txt');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'file with spaces.txt'))).toBe(false);
  });

  it('B16 — deletes a file with accented characters', async () => {
    const res = await request(app).delete(`/api/browse/media/${encodeURIComponent('café.txt')}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'café.txt'))).toBe(false);
  });
});

describe('POST /api/browse/:folderKey/:filename/move', () => {
  let srcDir: string;
  let dstDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    srcDir = mkdtempSync(path.join(tmpdir(), 'wd-test-move-src-'));
    dstDir = mkdtempSync(path.join(tmpdir(), 'wd-test-move-dst-'));

    writeFileSync(path.join(srcDir, 'moveme.txt'), 'move-content');
    writeFileSync(path.join(srcDir, 'stay.txt'), 'stay-content');

    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `source:${srcDir};target:${dstDir}`,
    });
    app = buildApp();
  });

  afterEach(() => {
    resetEnv();
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstDir, { recursive: true, force: true });
  });

  it('B17 — moves a file to another folder', async () => {
    const res = await request(app)
      .post('/api/browse/source/moveme.txt/move')
      .send({ targetFolder: 'target' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // File removed from source
    expect(existsSync(path.join(srcDir, 'moveme.txt'))).toBe(false);
    // File present in target with same content
    expect(existsSync(path.join(dstDir, 'moveme.txt'))).toBe(true);
    expect(readFileSync(path.join(dstDir, 'moveme.txt'), 'utf-8')).toBe('move-content');

    // Other files untouched
    expect(existsSync(path.join(srcDir, 'stay.txt'))).toBe(true);

    // Source listing no longer contains the moved file
    const list = await request(app).get('/api/browse/source');
    const names = list.body.files.map((f: { name: string }) => f.name);
    expect(names).not.toContain('moveme.txt');
    expect(names).toContain('stay.txt');

    // Target listing contains the moved file
    const dstList = await request(app).get('/api/browse/target');
    const dstNames = dstList.body.files.map((f: { name: string }) => f.name);
    expect(dstNames).toContain('moveme.txt');
  });

  it('B18 — returns 400 for missing targetFolder', async () => {
    const res = await request(app)
      .post('/api/browse/source/moveme.txt/move')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetFolder/i);
  });

  it('B19 — returns 400 when source and target are the same', async () => {
    const res = await request(app)
      .post('/api/browse/source/moveme.txt/move')
      .send({ targetFolder: 'source' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same/i);
  });

  it('B20 — returns 400 for invalid source folder key', async () => {
    const res = await request(app)
      .post('/api/browse/nonexistent/moveme.txt/move')
      .send({ targetFolder: 'target' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*folder/i);
  });

  it('B21 — returns 400 for invalid target folder key', async () => {
    const res = await request(app)
      .post('/api/browse/source/moveme.txt/move')
      .send({ targetFolder: 'nonexistent' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*folder/i);
  });

  it('B22 — returns 404 for non-existent file', async () => {
    const res = await request(app)
      .post('/api/browse/source/nope.txt/move')
      .send({ targetFolder: 'target' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('B23 — returns 409 when file already exists in target', async () => {
    writeFileSync(path.join(dstDir, 'moveme.txt'), 'already-here');

    const res = await request(app)
      .post('/api/browse/source/moveme.txt/move')
      .send({ targetFolder: 'target' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);

    // Source file untouched
    expect(existsSync(path.join(srcDir, 'moveme.txt'))).toBe(true);
    // Target file untouched
    expect(readFileSync(path.join(dstDir, 'moveme.txt'), 'utf-8')).toBe('already-here');
  });

  it('B24 — blocks path traversal in filename', async () => {
    const res = await request(app)
      .post('/api/browse/source/..%2F..%2Fetc%2Fpasswd/move')
      .send({ targetFolder: 'target' });

    expect([400, 404]).toContain(res.status);
  });
});

describe('POST /api/browse — move auth required', () => {
  let srcDir: string;
  let dstDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    srcDir = mkdtempSync(path.join(tmpdir(), 'wd-test-move-auth-src-'));
    dstDir = mkdtempSync(path.join(tmpdir(), 'wd-test-move-auth-dst-'));
    writeFileSync(path.join(srcDir, 'secret.txt'), 'classified');

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `source:${srcDir};target:${dstDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstDir, { recursive: true, force: true });
  });

  it('B25 — move requires auth', async () => {
    const res = await request(app)
      .post('/api/browse/source/secret.txt/move')
      .send({ targetFolder: 'target' });

    expect(res.status).toBe(401);
    // File should not have been moved
    expect(existsSync(path.join(srcDir, 'secret.txt'))).toBe(true);
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

  it('B15 — deleting requires auth', async () => {
    const res = await request(app).delete('/api/browse/files/test.txt');
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
