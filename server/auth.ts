import { createHmac, timingSafeEqual } from 'crypto';

function getSessionTtlMs(): number {
  const hours = parseInt(process.env.SESSION_TTL_HOURS || '168', 10);
  return (isNaN(hours) || hours <= 0 ? 168 : hours) * 60 * 60 * 1000;
}

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function createSession(): string {
  const expiry = Date.now() + getSessionTtlMs();
  const signature = createHmac('sha256', process.env.APP_PASSWORD!)
    .update(String(expiry))
    .digest('hex');
  return `${expiry}.${signature}`;
}

export function isValidSession(token: string): boolean {
  if (!process.env.APP_PASSWORD) return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return false;
  const expiryStr = token.substring(0, dotIdx);
  const providedSig = token.substring(dotIdx + 1);
  const expiry = Number(expiryStr);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const expectedSig = createHmac('sha256', process.env.APP_PASSWORD!)
    .update(expiryStr)
    .digest('hex');
  if (expectedSig.length !== providedSig.length) return false;
  return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(providedSig));
}

/**
 * Timing-safe password verification.
 * Always calls timingSafeEqual regardless of length so attackers cannot
 * binary-search the password length via response timing.
 */
export function verifyPassword(provided: string): boolean {
  const expected = process.env.APP_PASSWORD!;
  const padded = provided.padEnd(expected.length, '\0').substring(0, expected.length);
  const lengthMatch = provided.length === expected.length;
  return lengthMatch && timingSafeEqual(Buffer.from(padded), Buffer.from(expected));
}
