/**
 * Integration tests — POST /api/auth
 *
 * Scenarios:
 *   A1  Auth disabled → returns { token: "no-auth" }
 *   A2  Auth enabled, correct password → returns HMAC-signed token
 *   A3  Auth enabled, wrong password → 401
 *   A4  Auth enabled, missing password field → 401
 *   A5  Rate-limit: 11th attempt within window → 429
 *   A6  Password as Bearer token accepted directly (stateless API access)
 *   A7  Wrong password as Bearer token → 401
 */

import request from 'supertest';
import { buildApp } from '../../server/app';
import { setEnv, resetEnv } from './helpers/env';

// HMAC token pattern: expiryTimestamp.hexSignature (SHA-256 = 64 hex chars)
const HMAC_TOKEN_RE = /^\d+\.[0-9a-f]{64}$/;

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

  it('A2 — correct password returns an HMAC-signed token', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(HMAC_TOKEN_RE);
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

  it('A6 — password used directly as Bearer token → 200 on protected endpoint', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Authorization', `Bearer ${CORRECT_PASSWORD}`);

    expect(res.status).toBe(200);
  });

  it('A7 — wrong password as Bearer token → 401', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Authorization', 'Bearer wrong-password');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
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

  it('A8 — password-as-Bearer brute-force via API endpoint is rate-limited', async () => {
    // Use a fresh app so this test owns its own passwordBearerLimiter counter.
    const freshApp = buildApp();

    // Exhaust the 100-attempt allowance with wrong passwords
    for (let i = 0; i < 100; i++) {
      await request(freshApp)
        .get('/api/config')
        .set('Authorization', 'Bearer wrong-password');
    }

    // The 101st wrong-password attempt must be rate-limited
    const res = await request(freshApp)
      .get('/api/config')
      .set('Authorization', 'Bearer wrong-password');

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many requests/i);
  });
});
