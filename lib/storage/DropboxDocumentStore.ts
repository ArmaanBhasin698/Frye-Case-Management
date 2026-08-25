import { Dropbox } from "dropbox";
import {
  DocumentAlreadyExistsError,
  DocumentNotFoundError,
  type DocumentStore,
} from "@/lib/storage/DocumentStore";
import type { DropboxStorageConfig } from "@/lib/storage/config";

/**
 * Keys are always server-generated (see lib/discovery/actions.ts) —
 * matterId/productionId (validated cuids) plus a randomUUID() and fixed
 * literal segments ("original", "stamped.pdf"). This pattern is
 * deliberately narrow: no leading slash (keys are relative, joined onto
 * `rootPath`), no ".." segments, and only the characters our own key
 * generation ever produces. Anything else is rejected before it reaches
 * the Dropbox API, the same defense-in-depth posture as
 * LocalDocumentStore's path-containment check.
 */
const SAFE_KEY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9/_.-]*[A-Za-z0-9])?$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Refusing to resolve an unsafe storage key.");
  }
}

/** Enough to debug from a server log — never the request headers or anything token-shaped. */
function describeDropboxError(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    const withError = error as { status?: unknown; error?: { error_summary?: unknown } };
    const summary = withError.error?.error_summary;
    return `status=${String(withError.status)}${typeof summary === "string" ? ` (${summary})` : ""}`;
  }
  return error instanceof Error ? error.message : "unknown error";
}

type DropboxTagged = { ".tag": unknown };

function hasTag(value: unknown, tag: string): value is DropboxTagged {
  return typeof value === "object" && value !== null && (value as DropboxTagged)[".tag"] === tag;
}

/**
 * Real, verified shape (live Dropbox API call, see docs/INTEGRATION_ARCHITECTURE.md)
 * for a `filesDownload` on a path that doesn't exist: status 409,
 * `error.error.error` === `{".tag":"path","path":{".tag":"not_found"}}`.
 */
function isDropboxNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  const inner = (error as { error?: { error?: unknown } }).error?.error;
  return status === 409 && hasTag(inner, "path") && hasTag((inner as { path?: unknown }).path, "not_found");
}

/**
 * Real, verified shape (live Dropbox API call, see docs/INTEGRATION_ARCHITECTURE.md)
 * for a `filesUpload` with `mode: { ".tag": "add" }` onto an existing path:
 * status 409, `error.error.error` ===
 * `{".tag":"path","reason":{".tag":"conflict",...}}`.
 */
function isDropboxConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  const inner = (error as { error?: { error?: unknown } }).error?.error;
  return status === 409 && hasTag(inner, "path") && hasTag((inner as { reason?: unknown }).reason, "conflict");
}

/**
 * Dropbox-backed `DocumentStore`, selected via `STORAGE_PROVIDER=dropbox`
 * (see lib/storage/config.ts and lib/storage/DocumentStore.ts). Every key
 * is written under a dedicated, configurable root folder
 * (`DROPBOX_ROOT_PATH`, default `/FryeCaseManagement-DEV`) so this never
 * touches the rest of a Dropbox account even when the connected app has
 * full-Dropbox access rather than the narrower "App folder" access type —
 * see docs/SECURITY.md.
 *
 * `save` already uses `mode: { ".tag": "add" }`, which the real Dropbox
 * API refuses if the path already exists — matching the write-once
 * contract in DocumentStore.ts, without needing any code change here.
 *
 * `save`/`read` map the confirmed real Dropbox error shapes onto
 * `DocumentAlreadyExistsError`/`DocumentNotFoundError` (see
 * `isDropboxConflictError`/`isDropboxNotFoundError` above and
 * DocumentStore.ts for the contract every implementation shares). These
 * two tag shapes were verified against a live Dropbox API call, not just
 * assumed from docs — see docs/INTEGRATION_ARCHITECTURE.md. Every other
 * failure still wraps into one generic Error, exactly as before, so a
 * transient/unexpected Dropbox error never leaks raw API details.
 */
export class DropboxDocumentStore implements DocumentStore {
  private readonly client: Dropbox;
  private readonly rootPath: string;

  constructor(config: DropboxStorageConfig, client?: Dropbox) {
    this.rootPath = config.rootPath.replace(/\/+$/, "");
    this.client =
      client ??
      new Dropbox({
        clientId: config.appKey,
        clientSecret: config.appSecret,
        refreshToken: config.refreshToken,
      });
  }

  private resolvePath(key: string): string {
    assertSafeKey(key);
    return `${this.rootPath}/${key}`;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.resolvePath(key);
    try {
      await this.client.filesUpload({
        path,
        contents: data,
        // "add" (not "overwrite"): every key this app generates is unique
        // (see lib/discovery/actions.ts), so a collision here means
        // something is wrong — fail instead of silently overwriting an
        // original or a prior derivative.
        mode: { ".tag": "add" },
        autorename: false,
        mute: true,
      });
    } catch (error) {
      if (isDropboxConflictError(error)) {
        throw new DocumentAlreadyExistsError(key);
      }
      console.error("[DropboxDocumentStore] upload failed", describeDropboxError(error));
      throw new Error("Failed to save file to Dropbox.");
    }
  }

  async read(key: string): Promise<Buffer> {
    const path = this.resolvePath(key);
    try {
      const response = await this.client.filesDownload({ path });
      const { fileBinary } = response.result as unknown as { fileBinary: Uint8Array };
      return Buffer.from(fileBinary);
    } catch (error) {
      if (isDropboxNotFoundError(error)) {
        throw new DocumentNotFoundError(key);
      }
      console.error("[DropboxDocumentStore] download failed", describeDropboxError(error));
      throw new Error("Failed to read file from Dropbox.");
    }
  }
}
