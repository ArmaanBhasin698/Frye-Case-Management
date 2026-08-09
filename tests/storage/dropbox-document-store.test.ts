import { describe, expect, it, vi } from "vitest";

import { DropboxDocumentStore } from "@/lib/storage/DropboxDocumentStore";

const baseConfig = {
  appKey: "test-app-key",
  appSecret: "test-app-secret",
  refreshToken: "test-refresh-token",
  rootPath: "/FryeCaseManagement-DEV",
};

function fakeClient() {
  return {
    filesUpload: vi.fn().mockResolvedValue({ result: {} }),
    filesDownload: vi.fn(),
  };
}

describe("DropboxDocumentStore.save", () => {
  it("uploads under the configured root path with a safe, non-overwriting write mode", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await store.save("matters/m1/discovery/p1/f1/original", Buffer.from("hello"));

    expect(client.filesUpload).toHaveBeenCalledWith({
      path: "/FryeCaseManagement-DEV/matters/m1/discovery/p1/f1/original",
      contents: Buffer.from("hello"),
      mode: { ".tag": "add" },
      autorename: false,
      mute: true,
    });
  });

  it("strips a trailing slash from the configured root path", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore({ ...baseConfig, rootPath: "/FryeCaseManagement-DEV/" }, client as never);

    await store.save("file", Buffer.from("x"));

    expect(client.filesUpload).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/FryeCaseManagement-DEV/file" }),
    );
  });

  it("keeps the original and a stamped derivative at distinct paths", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await store.save("matters/m1/discovery/p1/f1/original", Buffer.from("original bytes"));
    await store.save("matters/m1/discovery/p1/f1/stamped.pdf", Buffer.from("stamped bytes"));

    const paths = client.filesUpload.mock.calls.map((call) => call[0].path);
    expect(paths).toEqual([
      "/FryeCaseManagement-DEV/matters/m1/discovery/p1/f1/original",
      "/FryeCaseManagement-DEV/matters/m1/discovery/p1/f1/stamped.pdf",
    ]);
    expect(new Set(paths).size).toBe(2);
  });

  it("rejects a key that attempts path traversal, without calling the Dropbox API", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await expect(store.save("../../etc/passwd", Buffer.from("x"))).rejects.toThrow();
    expect(client.filesUpload).not.toHaveBeenCalled();
  });

  it("rejects a key with a double slash", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await expect(store.save("matters//escape", Buffer.from("x"))).rejects.toThrow();
    expect(client.filesUpload).not.toHaveBeenCalled();
  });

  it("rejects a key with a leading slash (must be relative to the root)", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await expect(store.save("/absolute/key", Buffer.from("x"))).rejects.toThrow();
    expect(client.filesUpload).not.toHaveBeenCalled();
  });

  it("wraps a Dropbox API failure in a generic error, never surfacing the raw SDK error", async () => {
    const client = fakeClient();
    client.filesUpload.mockRejectedValue({
      status: 401,
      headers: { Authorization: "Bearer super-secret-token-value" },
      error: { error_summary: "invalid_access_token/" },
    });
    const store = new DropboxDocumentStore(baseConfig, client as never);

    let thrown: unknown;
    try {
      await store.save("some/key", Buffer.from("x"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe("Failed to save file to Dropbox.");
    expect(message).not.toContain("super-secret-token-value");
  });
});

describe("DropboxDocumentStore.read", () => {
  it("downloads from the configured root path and returns a Buffer", async () => {
    const client = fakeClient();
    const fileBinary = new Uint8Array(Buffer.from("file contents"));
    client.filesDownload.mockResolvedValue({ result: { fileBinary } });
    const store = new DropboxDocumentStore(baseConfig, client as never);

    const result = await store.read("matters/m1/discovery/p1/f1/original");

    expect(client.filesDownload).toHaveBeenCalledWith({
      path: "/FryeCaseManagement-DEV/matters/m1/discovery/p1/f1/original",
    });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("file contents");
  });

  it("wraps a Dropbox API failure in a generic error", async () => {
    const client = fakeClient();
    client.filesDownload.mockRejectedValue({
      status: 409,
      headers: {},
      error: { error_summary: "path/not_found/" },
    });
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await expect(store.read("missing/key")).rejects.toThrow("Failed to read file from Dropbox.");
  });

  it("rejects an unsafe key before calling the Dropbox API", async () => {
    const client = fakeClient();
    const store = new DropboxDocumentStore(baseConfig, client as never);

    await expect(store.read("../secrets")).rejects.toThrow();
    expect(client.filesDownload).not.toHaveBeenCalled();
  });
});
