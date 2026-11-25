import { test as base, expect } from "@playwright/test";
import { OWNER_STATE_FILE } from "./paths";

/**
 * Signed-in tests share one owner session.
 *
 * The refresh token is single-use: every page boot calls `/auth/refresh`, which
 * rotates it, and a rotated token is only honoured again inside a short grace
 * window. A storage state saved once would therefore go stale after the first
 * test. This auto fixture writes the context's current cookies back to the
 * state file when each test ends, so the next test (one worker, serial) starts
 * from the token the previous one received. It also keeps the suite at one UI
 * login per run, well inside the 5/min login rate limit.
 */
export const test = base.extend<{ persistSession: void }>({
  persistSession: [
    async ({ context }, use) => {
      await use();
      await context.storageState({ path: OWNER_STATE_FILE });
    },
    { auto: true },
  ],
});

export { expect };
