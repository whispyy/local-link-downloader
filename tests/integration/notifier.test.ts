/**
 * Integration tests — Discord webhook notifications
 *
 * Scenarios:
 *   N1  No DISCORD_WEBHOOK_URL set → fetch is never called
 *   N2  Upload → sends "Upload started" and "Upload completed" notifications
 *   N3  Download → sends "Download started" notification
 *   N4  Download completion → sends "Download completed" notification (real network)
 *   N5  Notification payload has correct shape (POST, JSON, content field)
 */

import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

const itNetwork = process.env.TEST_NETWORK ? it : it.skip;

/** Collect all fetch calls targeting the webhook URL. */
let fetchCalls: { url: string; init: RequestInit }[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('discord.com/api/webhooks')) {
      fetchCalls.push({ url, init: init! });
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Parse the Discord message content from a captured fetch call. */
function messageAt(index: number): string {
  const body = JSON.parse(fetchCalls[index].init.body as string);
  return body.content;
}

/** Poll /api/status/:id until the job leaves active states or timeout. */
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

describe('Discord notifications', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wd-test-notif-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── N1 — No webhook URL ─────────────────────────────────────────────────────

  describe('when DISCORD_WEBHOOK_URL is not set', () => {
    let app: ReturnType<typeof buildApp>;

    beforeAll(() => {
      setEnv({
        APP_PASSWORD: undefined,
        DOWNLOAD_FOLDERS: `files:${tmpDir}`,
        ALLOWED_EXTENSIONS: '.txt',
        DISCORD_WEBHOOK_URL: undefined,
      });
      app = buildApp();
    });

    afterAll(() => resetEnv());

    it('N1 — upload does not trigger any fetch call', async () => {
      await request(app)
        .post('/api/upload')
        .field('folderKey', 'files')
        .attach('file', Buffer.from('hello'), 'test.txt');

      // Give async work a moment to flush
      await new Promise((r) => setTimeout(r, 100));
      expect(fetchCalls).toHaveLength(0);
    });
  });

  // ── N2–N5 — With webhook URL ───────────────────────────────────────────────

  describe('when DISCORD_WEBHOOK_URL is set', () => {
    let app: ReturnType<typeof buildApp>;
    const WEBHOOK = 'https://discord.com/api/webhooks/test/fake-token';

    beforeAll(() => {
      setEnv({
        APP_PASSWORD: undefined,
        DOWNLOAD_FOLDERS: `files:${tmpDir}`,
        ALLOWED_EXTENSIONS: '.txt',
        DISCORD_WEBHOOK_URL: WEBHOOK,
      });
      app = buildApp();
    });

    afterAll(() => resetEnv());

    it('N2 — upload sends start and completed notifications', async () => {
      const res = await request(app)
        .post('/api/upload')
        .field('folderKey', 'files')
        .attach('file', Buffer.from('hello'), 'notif-upload.txt');

      expect(res.status).toBe(200);

      // Give async work a moment to flush
      await new Promise((r) => setTimeout(r, 100));

      expect(fetchCalls.length).toBe(2);
      expect(messageAt(0)).toMatch(/upload started/i);
      expect(messageAt(0)).toContain('notif-upload.txt');
      expect(messageAt(1)).toMatch(/upload completed/i);
      expect(messageAt(1)).toContain('notif-upload.txt');
    });

    it('N3 — download sends start notification', async () => {
      fetchCalls = [];

      const res = await request(app)
        .post('/api/download')
        .send({
          url: 'https://example.com/sample.txt',
          folderKey: 'files',
        });

      expect(res.status).toBe(200);

      // The "started" notification is sent synchronously before the response
      await new Promise((r) => setTimeout(r, 100));

      const startMsg = fetchCalls.find((c) =>
        JSON.parse(c.init.body as string).content.match(/download started/i),
      );
      expect(startMsg).toBeDefined();
      expect(startMsg!.url).toBe(WEBHOOK);
    });

    itNetwork(
      'N4 — download completion sends completed notification',
      async () => {
        fetchCalls = [];

        const res = await request(app)
          .post('/api/download')
          .send({
            url: 'https://httpbin.org/bytes/512',
            folderKey: 'files',
            filenameOverride: 'notif-dl.txt',
          });

        expect(res.status).toBe(200);
        const { id } = res.body as { id: string };

        await pollUntilDone(app, id);

        const completedMsg = fetchCalls.find((c) =>
          JSON.parse(c.init.body as string).content.match(/download completed/i),
        );
        expect(completedMsg).toBeDefined();
      },
      25_000,
    );

    it('N5 — notification payload is a POST with JSON content type', async () => {
      fetchCalls = [];

      await request(app)
        .post('/api/upload')
        .field('folderKey', 'files')
        .attach('file', Buffer.from('payload-check'), 'payload.txt');

      await new Promise((r) => setTimeout(r, 100));

      expect(fetchCalls.length).toBeGreaterThanOrEqual(1);

      const call = fetchCalls[0];
      expect(call.url).toBe(WEBHOOK);
      expect(call.init.method).toBe('POST');
      expect(call.init.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );

      const body = JSON.parse(call.init.body as string);
      expect(typeof body.content).toBe('string');
      expect(body.content.length).toBeGreaterThan(0);
    });
  });
});
