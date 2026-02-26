/**
 * Integration tests — DELETE /api/jobs/:jobId  (cancel)
 *
 * Scenarios:
 *   X1  Unknown job ID → 404
 *   X2  Cancel a queued job → 200 { status: "cancelled" }
 *       Requires network access (uses httpbin.org/delay/10). Set TEST_NETWORK=1 to enable.
 *   X3  Cancel an already-done job → 400 "Cannot cancel"
 *   X4  Cancel an already-cancelled job → 400 "Cannot cancel"
 *       Requires network access (uses httpbin.org/delay/10). Set TEST_NETWORK=1 to enable.
 */

import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

/**
 * Use `itNetwork` for tests that make real outbound HTTP calls.
 * Skipped unless TEST_NETWORK=1 is set.
 */
const itNetwork = process.env.TEST_NETWORK ? it : it.skip;

describe('DELETE /api/jobs/:jobId', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-cancel-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
      ALLOWED_EXTENSIONS: undefined,
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('X1 — unknown job ID returns 404', async () => {
    const res = await request(app).delete('/api/jobs/00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
  });

  itNetwork('X2 — cancel a queued job returns 200 with status "cancelled"', async () => {
    // Start a download to a slow/unreachable host so the job stays in "queued"
    // long enough for us to cancel it.  We use a non-routable address so the
    // TCP connection hangs rather than failing immediately.
    const startRes = await request(app)
      .post('/api/download')
      .send({
        // httpbin /delay/10 waits 10 seconds — plenty of time to cancel
        url: 'https://httpbin.org/delay/10',
        folderKey: 'files',
        filenameOverride: 'slow.txt',
      });

    expect(startRes.status).toBe(200);
    const { id } = startRes.body as { id: string };

    // Cancel immediately — the job may still be "queued" or just entered "downloading"
    const cancelRes = await request(app).delete(`/api/jobs/${id}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.id).toBe(id);
    expect(cancelRes.body.status).toBe('cancelled');
  });

  it('X3 — cancel a done job returns 400', async () => {
    // Upload creates a job that is immediately "done"
    const uploadRes = await request(app)
      .post('/api/upload')
      .field('folderKey', 'files')
      .attach('file', Buffer.from('data'), 'done.txt');

    const { id } = uploadRes.body as { id: string };

    const res = await request(app).delete(`/api/jobs/${id}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot cancel/i);
  });

  itNetwork('X4 — cancel an already-cancelled job returns 400', async () => {
    // Start and immediately cancel a job
    const startRes = await request(app)
      .post('/api/download')
      .send({
        url: 'https://httpbin.org/delay/10',
        folderKey: 'files',
        filenameOverride: 'slow2.txt',
      });

    const { id } = startRes.body as { id: string };
    await request(app).delete(`/api/jobs/${id}`); // first cancel

    // Second cancel attempt
    const res = await request(app).delete(`/api/jobs/${id}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot cancel/i);
  });
});
