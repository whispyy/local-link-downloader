/**
 * helpers/env.ts
 *
 * Utilities for controlling process.env inside integration tests.
 * Call setEnv() in beforeAll / beforeEach and resetEnv() in afterAll / afterEach
 * to ensure environment variables don't bleed between test suites.
 *
 * A snapshot *stack* is used so that nested or sequential setEnv() calls
 * (e.g. beforeAll + beforeEach) each save their own baseline and can be
 * independently restored by the matching resetEnv() call.
 */

type EnvSnapshot = Record<string, string | undefined>;

const snapshotStack: EnvSnapshot[] = [];

/**
 * Save the current values of the given keys and apply the provided overrides.
 * Keys set to `undefined` are deleted from process.env.
 * Each call pushes a new snapshot frame; pair with a matching resetEnv() call.
 */
export function setEnv(overrides: Record<string, string | undefined>): void {
  const snap: EnvSnapshot = {};
  for (const key of Object.keys(overrides)) {
    snap[key] = process.env[key];
  }
  snapshotStack.push(snap);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Restore process.env to the state captured by the most recent setEnv() call.
 * Pops one frame from the snapshot stack.
 */
export function resetEnv(): void {
  const snap = snapshotStack.pop();
  if (!snap) return; // no-op if called without a matching setEnv()

  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
