/**
 * Narrow interface every file-backed feature (Discovery, and eventually
 * Documents) talks to instead of calling a storage SDK directly — see
 * CLAUDE.md, section 4.6 and docs/ARCHITECTURE.md's "Documents & Dropbox"
 * section. `LocalDocumentStore` below is a local-disk stand-in; swapping in
 * a Dropbox-backed implementation later means writing one class here, not
 * touching lib/discovery/ or any Server Action that calls `documentStore`.
 *
 * Contract every implementation must honor, so callers (and future
 * provider adapters) get identical behavior regardless of backend:
 * - `save` is write-once. Every key this app generates is a fresh id (see
 *   lib/discovery/actions.ts, lib/documents/actions.ts) — a caller
 *   `save`-ing to a key that already exists means something is wrong
 *   (a retried request replaying an already-successful write, a key
 *   collision), not an intentional overwrite. Implementations throw
 *   `DocumentAlreadyExistsError` in that case rather than silently
 *   overwriting. `DropboxDocumentStore` already does this (`mode: "add"`);
 *   `LocalDocumentStore` matches it below.
 * - `read` of a key that was never saved (or no longer exists) throws
 *   `DocumentNotFoundError`, distinct from any other read failure, so a
 *   caller that cares can tell "definitely missing" from "provider had a
 *   problem" without parsing a message string. Existing callers (the
 *   Document/Discovery download routes) don't need that distinction today
 *   — they already catch any `read` failure and return the same generic
 *   404 — but new code (e.g. the telephony recording-retrieval flow) can
 *   rely on it directly instead of string-matching.
 */
export interface DocumentStore {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}

/** Thrown by `read` when no data has ever been (or is no longer) stored at `key`. */
export class DocumentNotFoundError extends Error {
  constructor(key: string) {
    super(`No document exists at key "${key}".`);
    this.name = "DocumentNotFoundError";
  }
}

/** Thrown by `save` when `key` already has data — every key this app generates should be fresh; a collision means retry/reuse, not an intentional overwrite. */
export class DocumentAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`A document already exists at key "${key}".`);
    this.name = "DocumentAlreadyExistsError";
  }
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev/demo-only stand-in for the eventual Dropbox integration. Stores
 * fictional discovery files under a gitignored directory at the repo root
 * (`local-data/discovery-files`) — never used for real client data, per
 * CLAUDE.md section 2.
 */
export class LocalDocumentStore implements DocumentStore {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const resolved = path.resolve(this.rootDir, key);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
      // Defense in depth: keys are server-generated (see lib/discovery/actions.ts),
      // never taken verbatim from user input, but this keeps it that way.
      throw new Error("Refusing to resolve a storage key outside the store root.");
    }
    return resolved;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      // "wx": create-exclusive, same fail-if-exists semantics as
      // DropboxDocumentStore's `mode: { ".tag": "add" }` — see the
      // DocumentStore contract above.
      await writeFile(filePath, data, { flag: "wx" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new DocumentAlreadyExistsError(key);
      }
      throw error;
    }
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new DocumentNotFoundError(key);
      }
      throw error;
    }
  }
}

import { getStorageProvider, readDropboxConfig } from "@/lib/storage/config";
import { DropboxDocumentStore } from "@/lib/storage/DropboxDocumentStore";

/**
 * Picks the `DocumentStore` implementation via `STORAGE_PROVIDER` (see
 * lib/storage/config.ts) — "local" (default) or "dropbox". Exported as a
 * named function, not just the `documentStore` singleton below, so tests
 * can exercise the selection logic (including the "dropbox selected but
 * misconfigured" failure) without constructing a real Dropbox client or
 * touching local disk — see tests/storage/document-store.test.ts.
 */
export function createDocumentStore(): DocumentStore {
  const provider = getStorageProvider();
  if (provider === "dropbox") {
    // Fail loudly at startup rather than on the first Discovery upload —
    // a missing Dropbox variable should never surface as a confusing
    // mid-request 500.
    return new DropboxDocumentStore(readDropboxConfig());
  }
  return new LocalDocumentStore(path.join(process.cwd(), "local-data", "discovery-files"));
}

export const documentStore: DocumentStore = createDocumentStore();
