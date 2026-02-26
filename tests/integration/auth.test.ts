/**
 * Integration tests — POST /api/auth
 *
 * Scenarios:
 *   A1  Auth disabled → returns { token: "no-auth" }
 *   A2  Auth enabled, correct password → returns UUID token
 *   A3  Auth enabled, wrong password → 401
 *   A4  Auth enabled, missing password field → 401
 *   A5  Rate-limit: 11th attempt within window → 429
 */

import request from 'supertest';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

// UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── A1 — Auth disabled ───────────────────────────────────────────────────────
describe('POST /api/auth — auth disabled', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    setEnv({ APP_PASSWORD: undefined });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
  });

  it('A1 — returns { token: "no-auth" } regardless of body', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ password: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'no-auth' });
  });
});

// ─── A2–A5 — Auth enabled ─────────────────────────────────────────────────────
describe('POST /api/auth — auth enabled', () => {
  const CORRECT_PASSWORD = 'super-secret-pw';
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    setEnv({ APP_PASSWORD: CORRECT_PASSWORD });
    app = buildApp();
  });

  afterAll(() => {
    resetEnv();
  });

  it('A2 — correct password returns a UUID token', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(UUID_RE);
  });

  it('A3 — wrong password returns 401 with "Invalid password"', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid password');
  });

  it('A4 — missing password field returns 401', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid password');
  });

  it('A5 — 11th attempt within rate-limit window returns 429', async () => {
    // Use a fresh app instance so this test owns its own rate-limit counter
    // and is not affected by the number of requests made in A2–A4 above.
    const freshApp = buildApp();

    // Exhaust the 10-request allowance
    for (let i = 0; i < 10; i++) {
      await request(freshApp).post('/api/auth').send({ password: 'bad' });
    }

    // The 11th request must be rate-limited
    const res = await request(freshApp)
      .post('/api/auth')
      .send({ password: 'bad' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many login attempts/i);
  });
});
