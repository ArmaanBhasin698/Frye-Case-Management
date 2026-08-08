import { describe, expect, it } from "vitest";

import { hashBuffer } from "@/lib/discovery/hash";

describe("hashBuffer", () => {
  it("matches a known SHA-256 vector", () => {
    // sha256("abc") — a standard test vector.
    expect(hashBuffer(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic for the same content", () => {
    const data = Buffer.from("Fictional discovery content — State v. Test Case.");
    expect(hashBuffer(data)).toBe(hashBuffer(Buffer.from(data)));
  });

  it("differs for different content", () => {
    expect(hashBuffer(Buffer.from("file A"))).not.toBe(hashBuffer(Buffer.from("file B")));
  });
});
