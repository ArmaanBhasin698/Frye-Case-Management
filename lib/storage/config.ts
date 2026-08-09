/**
 * Storage-provider selection for lib/storage/DocumentStore.ts. Kept
 * separate from DocumentStore.ts itself so the selection logic and the
 * Dropbox config-validation logic are independently unit-testable without
 * constructing a real Dropbox client or touching local disk — see
 * tests/storage/config.test.ts.
 */

export type StorageProvider = "local" | "dropbox";

/** Reads STORAGE_PROVIDER fresh on every call (not cached) so tests can vary it per-case with vi.stubEnv. */
export function getStorageProvider(): StorageProvider {
  const raw = (process.env.STORAGE_PROVIDER ?? "local").trim().toLowerCase();
  if (raw === "" || raw === "local") return "local";
  if (raw === "dropbox") return "dropbox";
  throw new Error(`Invalid STORAGE_PROVIDER "${raw}" — expected "local" or "dropbox".`);
}

export type DropboxStorageConfig = {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  /** Absolute Dropbox path every key is written under, e.g. "/FryeCaseManagement-DEV". */
  rootPath: string;
};

/**
 * Validates the Dropbox environment configuration and returns it, or
 * throws a clear error naming exactly which variables are missing. The
 * error message never includes a variable's value — only which ones are
 * unset — so it's safe to surface in a server log or a boot-time crash
 * without risking a leaked secret.
 */
export function readDropboxConfig(): DropboxStorageConfig {
  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim();
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim();
  const rootPath = process.env.DROPBOX_ROOT_PATH?.trim() || "/FryeCaseManagement-DEV";

  const missing = [
    !appKey && "DROPBOX_APP_KEY",
    !appSecret && "DROPBOX_APP_SECRET",
    !refreshToken && "DROPBOX_REFRESH_TOKEN",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `STORAGE_PROVIDER=dropbox requires ${missing.join(", ")} to be set — see .env.example.`,
    );
  }
  if (!rootPath.startsWith("/")) {
    throw new Error('DROPBOX_ROOT_PATH must start with "/" — Dropbox API paths are absolute.');
  }

  return { appKey: appKey!, appSecret: appSecret!, refreshToken: refreshToken!, rootPath };
}
