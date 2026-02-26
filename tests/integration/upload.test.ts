/**
 * Integration tests — POST /api/upload
 *
 * Scenarios:
 *   U1  No file attached → 400 "No file provided"
 *   U2  Missing folderKey → 400
 *   U3  Invalid folderKey → 400
 *   U4  Extension not in ALLOWED_EXTENSIONS → 400
 *   U5  Valid upload → 200 { id, status: "done", filename, folder_key, message }
 *   U6  Valid upload → file actually written to disk
 *   U7  filenameOverride is respected
 */

import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('POST /api/upload', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-upload-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
      ALLOWED_EXTENSIONS: '.txt,.jpg,.png',
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Validation errors ────────────────────────────────────────────────────────

  it('U1 — no file attached returns 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file provided');
  });

  it('U2 — missing folderKey returns 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('hello'), 'hello.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required field/i);
  });

  it('U3 — invalid folderKey returns 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'nonexistent')
      .attach('file', Buffer.from('hello'), 'hello.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid folder key/i);
  });

  it('U4 — disallowed extension (.exe) returns 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('MZ'), 'virus.exe');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('U5 — valid upload returns 200 with correct shape', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('hello world'), 'sample.txt');

    expect(res.status).toBe(200);

    const body = res.body as Record<string, unknown>;
    expect(body.id).toMatch(UUID_RE);
    expect(body.status).toBe('done');
    expect(body.filename).toBe('sample.txt');
    expect(body.folder_key).toBe('files');
    expect(typeof body.message).toBe('string');
  });

  it('U6 — uploaded file is actually written to disk', async () => {
    const content = 'disk-check-content';
    const filename = 'disk-check.txt';

    await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from(content), filename);

    const filePath = path.join(tmpDir, filename);
    expect(existsSync(filePath)).toBe(true);
  });

  it('U7 — filenameOverride is used as the saved filename', async () => {
    const override = 'custom-name.txt';

    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .field('filenameOverride', override)
      .attach('file', Buffer.from('override test'), 'original.txt');

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe(override);

    const filePath = path.join(tmpDir, override);
    expect(existsSync(filePath)).toBe(true);
  });
});
