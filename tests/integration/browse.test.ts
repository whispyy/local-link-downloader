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
 *   B26 Root listing includes dirs array
 *   B27 subpath=sub1 lists files inside sub1
 *   B28 subpath=sub1/sub2 works at depth 2
 *   B29 subpath=a/b/c returns 400 (exceeds depth)
 *   B30 subpath=../evil returns 400 (traversal)
 *   B31 Non-existent subpath returns empty
 *   B32 mkdir at root level
 *   B33 mkdir inside subfolder (depth 2)
 *   B34 mkdir rejected at depth 2 (would be depth 3)
 *   B35 mkdir rejects names with .. or /
 *   B36 mkdir returns 409 if exists
 *   B37 mkdir requires auth
 *   B38 Serve file from subfolder
 *   B39 Delete file from subfolder
 *   B40 Path traversal blocked in subpath for file ops
 *   B41 move-to-subpath moves file into subfolder
 *   B42 move-to-subpath moves file to parent (empty targetSubpath)
 *   B43 move-to-subpath rejects same source and target subpath
 *   B44 move-to-subpath returns 409 if file exists at target
 *   B45 move-to-subpath validates subpaths (traversal, depth)
 *   B46 move-to-subpath requires auth
 *   B47 rename-dir renames a subfolder
 *   B48 rename-dir returns 409 if target name exists
 *   B49 rename-dir returns 404 for non-existent dir
 *   B50 rename-dir rejects invalid names
 *   B51 rmdir deletes a subfolder and its contents
 *   B52 rmdir returns 404 for non-existent dir
 *   B53 rmdir rejects invalid names
 *   B54 rename-dir requires auth
 *   B55 rmdir requires auth
 *   B56 rename-dir with nested subpath
 *   B57 rename-file renames a file
 *   B58 rename-file returns 409 if target name already exists
 *   B59 rename-file returns 404 for non-existent file
 *   B60 rename-file rejects invalid names
 *   B61 rename-file returns 400 when oldName targets a directory
 *   B62 rename-file works inside a nested subpath
 *   B63 rename-file requires auth
 */

import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
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

// ── Subfolder browsing ──────────────────────────────────────────────────────

describe('GET /api/browse — subfolder navigation', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-subfolder-'));

    // Root files
    writeFileSync(path.join(tmpDir, 'root.txt'), 'root-content');

    // sub1/
    mkdirSync(path.join(tmpDir, 'sub1'));
    writeFileSync(path.join(tmpDir, 'sub1', 'nested.txt'), 'nested-content');

    // sub1/sub2/
    mkdirSync(path.join(tmpDir, 'sub1', 'sub2'));
    writeFileSync(path.join(tmpDir, 'sub1', 'sub2', 'deep.txt'), 'deep-content');

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

  it('B26 — root listing includes dirs array', async () => {
    const res = await request(app).get('/api/browse/media');

    expect(res.status).toBe(200);
    expect(res.body.dirs).toBeInstanceOf(Array);
    const dirNames = res.body.dirs.map((d: { name: string }) => d.name);
    expect(dirNames).toContain('sub1');
    expect(res.body.subpath).toBe('');
    expect(res.body.maxDepth).toBe(2);
  });

  it('B27 — subpath=sub1 lists files inside sub1', async () => {
    const res = await request(app).get('/api/browse/media?subpath=sub1');

    expect(res.status).toBe(200);
    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('nested.txt');
    expect(names).not.toContain('root.txt');
    // sub2 should appear in dirs
    const dirNames = res.body.dirs.map((d: { name: string }) => d.name);
    expect(dirNames).toContain('sub2');
  });

  it('B28 — subpath=sub1/sub2 works at depth 2', async () => {
    const res = await request(app).get('/api/browse/media?subpath=sub1/sub2');

    expect(res.status).toBe(200);
    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('deep.txt');
    // At depth 2, dirs should be empty (can't navigate deeper)
    expect(res.body.dirs).toEqual([]);
  });

  it('B29 — subpath=a/b/c returns 400 (exceeds depth)', async () => {
    const res = await request(app).get('/api/browse/media?subpath=a/b/c');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/depth/i);
  });

  it('B30 — subpath=../evil returns 400 (traversal)', async () => {
    const res = await request(app).get('/api/browse/media?subpath=../evil');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traversal/i);
  });

  it('B31 — non-existent subpath returns empty', async () => {
    const res = await request(app).get('/api/browse/media?subpath=nonexistent');

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
    expect(res.body.dirs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('B38 — serve file from subfolder', async () => {
    const res = await request(app)
      .get('/api/browse/media/nested.txt?subpath=sub1')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('nested-content');
  });

  it('B39 — delete file from subfolder', async () => {
    // Create a disposable file
    writeFileSync(path.join(tmpDir, 'sub1', 'deleteme.txt'), 'delete-me');

    const res = await request(app).delete('/api/browse/media/deleteme.txt?subpath=sub1');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'sub1', 'deleteme.txt'))).toBe(false);
  });

  it('B40 — path traversal blocked in subpath for file ops', async () => {
    const res = await request(app).get('/api/browse/media/root.txt?subpath=sub1/../../');

    expect(res.status).toBe(400);
  });
});

// ── mkdir ───────────────────────────────────────────────────────────────────

describe('POST /api/browse/:folderKey/mkdir', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-mkdir-'));
    mkdirSync(path.join(tmpDir, 'existing'));
    mkdirSync(path.join(tmpDir, 'level1'));

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

  it('B32 — mkdir at root level', async () => {
    const res = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'newfolder' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('newfolder');
    expect(existsSync(path.join(tmpDir, 'newfolder'))).toBe(true);
  });

  it('B33 — mkdir inside subfolder (depth 2)', async () => {
    const res = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'nested', subpath: 'level1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'level1', 'nested'))).toBe(true);
  });

  it('B34 — mkdir rejected at depth 2 (would be depth 3)', async () => {
    mkdirSync(path.join(tmpDir, 'level1', 'level2'));

    const res = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'tooDeep', subpath: 'level1/level2' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/depth/i);
  });

  it('B35 — mkdir rejects names with .. or /', async () => {
    const res1 = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: '../evil' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'foo/bar' });
    expect(res2.status).toBe(400);
  });

  it('B36 — mkdir returns 409 if exists', async () => {
    const res = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'existing' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe('POST /api/browse/:folderKey/mkdir — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-mkdir-auth-'));

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B37 — mkdir requires auth', async () => {
    const res = await request(app)
      .post('/api/browse/media/mkdir')
      .send({ name: 'nope' });

    expect(res.status).toBe(401);
    expect(existsSync(path.join(tmpDir, 'nope'))).toBe(false);
  });
});

// ── move-to-subpath ─────────────────────────────────────────────────────────

describe('POST /api/browse/:folderKey/:filename/move-to-subpath', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-mvsp-'));
    mkdirSync(path.join(tmpDir, 'sub1'));
    mkdirSync(path.join(tmpDir, 'sub1', 'sub2'));
    writeFileSync(path.join(tmpDir, 'root-file.txt'), 'root');
    writeFileSync(path.join(tmpDir, 'sub1', 'nested.txt'), 'nested');

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

  it('B41 — moves file into subfolder', async () => {
    const res = await request(app)
      .post('/api/browse/media/root-file.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: 'sub1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'root-file.txt'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'sub1', 'root-file.txt'))).toBe(true);
    expect(readFileSync(path.join(tmpDir, 'sub1', 'root-file.txt'), 'utf-8')).toBe('root');
  });

  it('B42 — moves file to parent (empty targetSubpath)', async () => {
    const res = await request(app)
      .post('/api/browse/media/nested.txt/move-to-subpath')
      .send({ sourceSubpath: 'sub1', targetSubpath: '' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'sub1', 'nested.txt'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'nested.txt'))).toBe(true);
    expect(readFileSync(path.join(tmpDir, 'nested.txt'), 'utf-8')).toBe('nested');
  });

  it('B43 — rejects same source and target subpath', async () => {
    const res = await request(app)
      .post('/api/browse/media/root-file.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same/i);
  });

  it('B44 — returns 409 if file exists at target', async () => {
    writeFileSync(path.join(tmpDir, 'sub1', 'root-file.txt'), 'already-here');

    const res = await request(app)
      .post('/api/browse/media/root-file.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: 'sub1' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    // Source untouched
    expect(existsSync(path.join(tmpDir, 'root-file.txt'))).toBe(true);
    expect(readFileSync(path.join(tmpDir, 'root-file.txt'), 'utf-8')).toBe('root');
  });

  it('B45 — validates subpaths (traversal and depth)', async () => {
    const res1 = await request(app)
      .post('/api/browse/media/root-file.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: '../evil' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/browse/media/root-file.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: 'a/b/c' });
    expect(res2.status).toBe(400);
  });
});

describe('POST /api/browse/:folderKey/:filename/move-to-subpath — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-mvsp-auth-'));
    mkdirSync(path.join(tmpDir, 'sub1'));
    writeFileSync(path.join(tmpDir, 'secret.txt'), 'classified');

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B46 — requires auth', async () => {
    const res = await request(app)
      .post('/api/browse/media/secret.txt/move-to-subpath')
      .send({ sourceSubpath: '', targetSubpath: 'sub1' });

    expect(res.status).toBe(401);
    expect(existsSync(path.join(tmpDir, 'secret.txt'))).toBe(true);
  });
});

// ── rename-dir ─────────────────────────────────────────────────────────────

describe('POST /api/browse/:folderKey/rename-dir', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-renamedir-'));
    mkdirSync(path.join(tmpDir, 'myfolder'));
    writeFileSync(path.join(tmpDir, 'myfolder', 'file.txt'), 'content');
    mkdirSync(path.join(tmpDir, 'existing'));

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

  it('B47 — renames a subfolder', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'myfolder', newName: 'renamed' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('renamed');
    expect(existsSync(path.join(tmpDir, 'myfolder'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'renamed'))).toBe(true);
    // Contents preserved
    expect(readFileSync(path.join(tmpDir, 'renamed', 'file.txt'), 'utf-8')).toBe('content');
  });

  it('B48 — returns 409 if target name already exists', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'myfolder', newName: 'existing' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    // Original untouched
    expect(existsSync(path.join(tmpDir, 'myfolder'))).toBe(true);
  });

  it('B49 — returns 404 for non-existent directory', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'nope', newName: 'whatever' });

    expect(res.status).toBe(404);
  });

  it('B50 — rejects invalid names', async () => {
    const res1 = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'myfolder', newName: '../evil' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'myfolder', newName: 'foo/bar' });
    expect(res2.status).toBe(400);
  });

  it('B56 — renames a subfolder with nested subpath', async () => {
    mkdirSync(path.join(tmpDir, 'myfolder', 'child'));
    writeFileSync(path.join(tmpDir, 'myfolder', 'child', 'deep.txt'), 'deep');

    const res = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: 'myfolder', oldName: 'child', newName: 'renamed-child' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('renamed-child');
    expect(existsSync(path.join(tmpDir, 'myfolder', 'child'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'myfolder', 'renamed-child'))).toBe(true);
    expect(readFileSync(path.join(tmpDir, 'myfolder', 'renamed-child', 'deep.txt'), 'utf-8')).toBe('deep');
  });
});

describe('POST /api/browse/:folderKey/rename-dir — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-renamedir-auth-'));
    mkdirSync(path.join(tmpDir, 'myfolder'));

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B54 — requires auth', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-dir')
      .send({ subpath: '', oldName: 'myfolder', newName: 'nope' });

    expect(res.status).toBe(401);
    expect(existsSync(path.join(tmpDir, 'myfolder'))).toBe(true);
  });
});

// ── rmdir ──────────────────────────────────────────────────────────────────

describe('DELETE /api/browse/:folderKey/rmdir', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-rmdir-'));
    mkdirSync(path.join(tmpDir, 'tobedeleted'));
    writeFileSync(path.join(tmpDir, 'tobedeleted', 'inner.txt'), 'inner-content');
    mkdirSync(path.join(tmpDir, 'tobedeleted', 'nested'));
    writeFileSync(path.join(tmpDir, 'tobedeleted', 'nested', 'deep.txt'), 'deep');

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

  it('B51 — deletes a subfolder and its contents', async () => {
    const res = await request(app)
      .delete('/api/browse/media/rmdir')
      .send({ subpath: '', name: 'tobedeleted' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(existsSync(path.join(tmpDir, 'tobedeleted'))).toBe(false);
  });

  it('B52 — returns 404 for non-existent directory', async () => {
    const res = await request(app)
      .delete('/api/browse/media/rmdir')
      .send({ subpath: '', name: 'nope' });

    expect(res.status).toBe(404);
  });

  it('B53 — rejects invalid names', async () => {
    const res = await request(app)
      .delete('/api/browse/media/rmdir')
      .send({ subpath: '', name: '../evil' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/browse/:folderKey/rmdir — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-rmdir-auth-'));
    mkdirSync(path.join(tmpDir, 'protected'));

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B55 — requires auth', async () => {
    const res = await request(app)
      .delete('/api/browse/media/rmdir')
      .send({ subpath: '', name: 'protected' });

    expect(res.status).toBe(401);
    expect(existsSync(path.join(tmpDir, 'protected'))).toBe(true);
  });
});

// ── rename-file ────────────────────────────────────────────────────────────

describe('POST /api/browse/:folderKey/rename-file', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-renamefile-'));
    writeFileSync(path.join(tmpDir, 'video.mp4'), 'data');
    writeFileSync(path.join(tmpDir, 'existing.mp4'), 'other');
    mkdirSync(path.join(tmpDir, 'adir'));

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

  it('B57 — renames a file', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'video.mp4', newName: 'renamed.mp4' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('renamed.mp4');
    expect(existsSync(path.join(tmpDir, 'video.mp4'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'renamed.mp4'))).toBe(true);
  });

  it('B58 — returns 409 if target name already exists', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'video.mp4', newName: 'existing.mp4' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    // Both files untouched
    expect(existsSync(path.join(tmpDir, 'video.mp4'))).toBe(true);
    expect(existsSync(path.join(tmpDir, 'existing.mp4'))).toBe(true);
  });

  it('B59 — returns 404 for non-existent file', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'ghost.mp4', newName: 'whatever.mp4' });

    expect(res.status).toBe(404);
  });

  it('B60 — rejects invalid new names', async () => {
    const res1 = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'video.mp4', newName: '../evil.mp4' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'video.mp4', newName: 'foo/bar.mp4' });
    expect(res2.status).toBe(400);

    const res3 = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'video.mp4', newName: '.hidden' });
    expect(res3.status).toBe(400);

    // Original untouched throughout
    expect(existsSync(path.join(tmpDir, 'video.mp4'))).toBe(true);
  });

  it('B61 — returns 400 when oldName targets a directory', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'adir', newName: 'renamed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a file/i);
    expect(existsSync(path.join(tmpDir, 'adir'))).toBe(true);
  });

  it('B62 — renames a file inside a nested subpath', async () => {
    mkdirSync(path.join(tmpDir, 'sub'));
    writeFileSync(path.join(tmpDir, 'sub', 'clip.mp4'), 'clip-data');

    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: 'sub', oldName: 'clip.mp4', newName: 'renamed-clip.mp4' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('renamed-clip.mp4');
    expect(existsSync(path.join(tmpDir, 'sub', 'clip.mp4'))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'sub', 'renamed-clip.mp4'))).toBe(true);
  });
});

describe('POST /api/browse/:folderKey/rename-file — auth required', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-renamefile-auth-'));
    writeFileSync(path.join(tmpDir, 'protected.mp4'), 'data');

    setEnv({
      APP_PASSWORD: 'secret123',
      DOWNLOAD_FOLDERS: `media:${tmpDir}`,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B63 — requires auth', async () => {
    const res = await request(app)
      .post('/api/browse/media/rename-file')
      .send({ subpath: '', oldName: 'protected.mp4', newName: 'nope.mp4' });

    expect(res.status).toBe(401);
    expect(existsSync(path.join(tmpDir, 'protected.mp4'))).toBe(true);
  });
});
