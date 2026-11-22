import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Signed-in owner session, written by auth.setup.ts and kept current by fixtures/test.ts. */
export const OWNER_STATE_FILE = join(e2eDir, ".auth", "owner.json");
