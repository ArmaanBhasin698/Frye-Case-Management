/**
 * Narrow interface every file-backed feature (Discovery, and eventually
 * Documents) talks to instead of calling a storage SDK directly — see
 * CLAUDE.md, section 4.6 and docs/ARCHITECTURE.md's "Documents & Dropbox"
 * section. `LocalDocumentStore` below is a local-disk stand-in; swapping in
 * a Dropbox-backed implementation later means writing one class here, not
 * touching lib/discovery/ or any Server Action that calls `documentStore`.
 */
export interface DocumentStore {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
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
    await writeFile(filePath, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

export const documentStore: DocumentStore = new LocalDocumentStore(
  path.join(process.cwd(), "local-data", "discovery-files"),
);
