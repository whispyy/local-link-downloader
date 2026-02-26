/**
 * Integration tests — POST /api/download
 *
 * Scenarios:
 *   D1  Missing url → 400
 *   D2  Missing folderKey → 400
 *   D3  Malformed URL → 400
 *   D4  Non-HTTP/HTTPS protocol → 400
 *   D5  Internal/private IP → 400
 *   D6  Invalid folderKey → 400
 *   D7  Extension not in ALLOWED_EXTENSIONS → 400
 *   D8  Path traversal via filenameOverride → 400
 *   D9  Valid request → 200 { id (UUID), status: "queued" }
 *   D10 Valid request → job eventually reaches "done" (real small-file download)
 *       Requires network access. Set TEST_NETWORK=1 to enable.
 */

import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Use `itNetwork` for tests that make real outbound HTTP calls.
 * They are skipped unless the TEST_NETWORK=1 environment variable is set,
 * so offline / air-gapped CI environments don't fail on network unavailability.
 */
const itNetwork = process.env.TEST_NETWORK ? it : it.skip;

/** Poll /api/status/:id until the job leaves the active states or timeout. */
async function pollUntilDone(
  app: ReturnType<typeof buildApp>,
  jobId: string,
  timeoutMs = 20_000,
): Promise<{ status: string; message?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/status/${jobId}`);
    const { status, message } = res.body as { status: string; message?: string };
    if (status !== 'queued' && status !== 'downloading') {
      return { status, message };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs} ms`);
}

describe('POST /api/download', () => {
  let tmpDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-dl-'));
    setEnv({
      APP_PASSWORD: undefined,
      DOWNLOAD_FOLDERS: `files:${tmpDir}`,
      ALLOWED_EXTENSIONS: '.jpg,.png,.zip,.txt',
    });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Validation errors ────────────────────────────────────────────────────────

  it('D1 — missing url returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required fields/i);
  });

  it('D2 — missing folderKey returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://example.com/file.txt' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required fields/i);
  });

  it('D3 — malformed URL returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'not-a-url', folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid URL format');
  });

  it('D4 — ftp:// protocol returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'ftp://example.com/file.txt', folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only http and https/i);
  });

  it('D5 — private IP (192.168.x.x) returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'http://192.168.1.1/file.txt', folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/internal\/private ip/i);
  });

  it('D5b — loopback IP (127.0.0.1) returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'http://127.0.0.1/file.txt', folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/internal\/private ip/i);
  });

  it('D6 — invalid folderKey returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://example.com/file.txt', folderKey: 'nonexistent' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid folder key/i);
  });

  it('D7 — disallowed extension (.exe) returns 400', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://example.com/malware.exe', folderKey: 'files' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('D8 — path traversal via filenameOverride is neutralised or rejected', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({
        url: 'https://example.com/file.txt',
        folderKey: 'files',
        filenameOverride: '../../etc/passwd',
      });

    // sanitizeFilename strips ".." and "/" so "../../etc/passwd" becomes "etcpasswd"
    // (no extension).  The extension check fires before the path-traversal guard,
    // so the server returns 400 with an extension-related error.
    // Any 400 is acceptable — the traversal was blocked one way or another.
    if (res.status === 400) {
      expect(res.body.error).toMatch(/path traversal|no extension|not allowed/i);
    } else {
      // sanitizer fully neutralised it and the sanitized name passed all checks
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
    }
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('D9 — valid request returns 200 with UUID id and status "queued"', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://example.com/sample.txt', folderKey: 'files' });

    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body.status).toBe('queued');
  });

  itNetwork(
    'D10 — job eventually reaches "done" after downloading a real small file',
    async () => {
      // httpbin returns exactly N random bytes — tiny and reliable
      const res = await request(app)
        .post('/api/download')
        .send({
          url: 'https://httpbin.org/bytes/1024',
          folderKey: 'files',
          filenameOverride: 'test-download.txt',
        });

      expect(res.status).toBe(200);
      const { id } = res.body as { id: string };

      const { status } = await pollUntilDone(app, id);
      expect(status).toBe('done');
    },
    25_000, // Jest per-test timeout
  );
});
