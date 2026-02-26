/**
 * Integration tests — GET /api/status/:jobId
 *
 * Scenarios:
 *   S1  Unknown job ID → 404 "Job not found"
 *   S2  Known job → 200 with correct response shape
 */

import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

describe('GET /api/status/:jobId', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;
  let knownJobId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-status-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
      ALLOWED_EXTENSIONS: undefined,
    });
    app = buildApp();

    // Create a known job via upload (synchronous, always "done")
    const res = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('hello'), 'hello.txt');

    knownJobId = (res.body as { id: string }).id;
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('S1 — unknown job ID returns 404', async () => {
    const res = await request(app).get('/api/status/00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
  });

  it('S2 — known job returns 200 with correct shape', async () => {
    const res = await request(app).get(`/api/status/${knownJobId}`);

    expect(res.status).toBe(200);

    const body = res.body as Record<string, unknown>;
    expect(body.id).toBe(knownJobId);
    expect(body.status).toBe('done');
    expect(body).toHaveProperty('filename');
    expect(body).toHaveProperty('folder_key');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('created_at');
    expect(body).toHaveProperty('updated_at');
  });
});
