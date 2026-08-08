import { createHash } from "node:crypto";

/** Content-identity hash for a registered file — the basis for duplicate/change detection in lib/discovery/compare.ts. */
export function hashBuffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
