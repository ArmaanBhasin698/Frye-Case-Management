import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getStorageProvider, readDropboxConfig } from "@/lib/storage/config";

const ENV_KEYS = [
  "STORAGE_PROVIDER",
  "DROPBOX_APP_KEY",
  "DROPBOX_APP_SECRET",
  "DROPBOX_REFRESH_TOKEN",
  "DROPBOX_ROOT_PATH",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("getStorageProvider", () => {
  it("defaults to local when unset", () => {
    expect(getStorageProvider()).toBe("local");
  });

  it("returns local for an explicit 'local' (case-insensitive)", () => {
    process.env.STORAGE_PROVIDER = "Local";
    expect(getStorageProvider()).toBe("local");
  });

  it("returns dropbox for an explicit 'dropbox'", () => {
    process.env.STORAGE_PROVIDER = "dropbox";
    expect(getStorageProvider()).toBe("dropbox");
  });

  it("rejects an unrecognized value", () => {
    process.env.STORAGE_PROVIDER = "s3";
    expect(() => getStorageProvider()).toThrow(/Invalid STORAGE_PROVIDER/);
  });
});

describe("readDropboxConfig", () => {
  it("returns the configured values plus a default root path", () => {
    process.env.DROPBOX_APP_KEY = "test-app-key";
    process.env.DROPBOX_APP_SECRET = "test-app-secret";
    process.env.DROPBOX_REFRESH_TOKEN = "test-refresh-token";

    expect(readDropboxConfig()).toEqual({
      appKey: "test-app-key",
      appSecret: "test-app-secret",
      refreshToken: "test-refresh-token",
      rootPath: "/FryeCaseManagement-DEV",
    });
  });

  it("honors a custom DROPBOX_ROOT_PATH", () => {
    process.env.DROPBOX_APP_KEY = "test-app-key";
    process.env.DROPBOX_APP_SECRET = "test-app-secret";
    process.env.DROPBOX_REFRESH_TOKEN = "test-refresh-token";
    process.env.DROPBOX_ROOT_PATH = "/CustomDevRoot";

    expect(readDropboxConfig().rootPath).toBe("/CustomDevRoot");
  });

  it("throws naming every missing variable, and never includes a value in the message", () => {
    process.env.DROPBOX_APP_KEY = "should-not-appear-in-error";

    let thrown: unknown;
    try {
      readDropboxConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("DROPBOX_APP_SECRET");
    expect(message).toContain("DROPBOX_REFRESH_TOKEN");
    expect(message).not.toContain("DROPBOX_APP_KEY");
    expect(message).not.toContain("should-not-appear-in-error");
  });

  it("rejects a root path that isn't absolute", () => {
    process.env.DROPBOX_APP_KEY = "k";
    process.env.DROPBOX_APP_SECRET = "s";
    process.env.DROPBOX_REFRESH_TOKEN = "r";
    process.env.DROPBOX_ROOT_PATH = "relative/path";

    expect(() => readDropboxConfig()).toThrow(/must start with/);
  });
});
