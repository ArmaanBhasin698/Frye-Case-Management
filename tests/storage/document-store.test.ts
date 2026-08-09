import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dropboxStoreCtor } = vi.hoisted(() => ({ dropboxStoreCtor: vi.fn() }));

vi.mock("@/lib/storage/DropboxDocumentStore", () => ({
  DropboxDocumentStore: dropboxStoreCtor,
}));

const { createDocumentStore, LocalDocumentStore } = await import("@/lib/storage/DocumentStore");

const ENV_KEYS = ["STORAGE_PROVIDER", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  dropboxStoreCtor.mockClear();
  dropboxStoreCtor.mockImplementation(function FakeDropboxDocumentStore(this: object) {
    return this;
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("createDocumentStore", () => {
  it("defaults to a LocalDocumentStore when STORAGE_PROVIDER is unset", () => {
    const store = createDocumentStore();
    expect(store).toBeInstanceOf(LocalDocumentStore);
    expect(dropboxStoreCtor).not.toHaveBeenCalled();
  });

  it("returns a LocalDocumentStore for STORAGE_PROVIDER=local", () => {
    process.env.STORAGE_PROVIDER = "local";
    expect(createDocumentStore()).toBeInstanceOf(LocalDocumentStore);
  });

  it("constructs a DropboxDocumentStore with validated config for STORAGE_PROVIDER=dropbox", () => {
    process.env.STORAGE_PROVIDER = "dropbox";
    process.env.DROPBOX_APP_KEY = "key";
    process.env.DROPBOX_APP_SECRET = "secret";
    process.env.DROPBOX_REFRESH_TOKEN = "token";

    createDocumentStore();

    expect(dropboxStoreCtor).toHaveBeenCalledWith({
      appKey: "key",
      appSecret: "secret",
      refreshToken: "token",
      rootPath: "/FryeCaseManagement-DEV",
    });
  });

  it("fails clearly instead of falling back to local storage when Dropbox config is incomplete", () => {
    process.env.STORAGE_PROVIDER = "dropbox";
    process.env.DROPBOX_APP_KEY = "key";
    // DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN intentionally left unset.

    expect(() => createDocumentStore()).toThrow(/DROPBOX_APP_SECRET/);
    expect(dropboxStoreCtor).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized STORAGE_PROVIDER rather than silently defaulting", () => {
    process.env.STORAGE_PROVIDER = "s3";
    expect(() => createDocumentStore()).toThrow(/Invalid STORAGE_PROVIDER/);
  });
});

describe("LocalDocumentStore (regression check)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "frye-local-store-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips a save/read exactly as before this change", async () => {
    const store = new LocalDocumentStore(tempDir);
    const original = Buffer.from("fictional discovery bytes — unchanged local behavior");

    await store.save("matters/m1/discovery/p1/f1/original", original);
    const readBack = await store.read("matters/m1/discovery/p1/f1/original");

    expect(Buffer.compare(readBack, original)).toBe(0);
  });

  it("still refuses to resolve a key that escapes the store root", async () => {
    const store = new LocalDocumentStore(tempDir);
    await expect(store.read("../../etc/passwd")).rejects.toThrow();
  });
});
