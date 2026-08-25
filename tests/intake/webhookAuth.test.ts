import { describe, expect, it } from "vitest";

import { isAuthorizedBearerToken } from "@/lib/intake/webhookAuth";

const SECRET = "fictional-webhook-secret-value";

describe("isAuthorizedBearerToken", () => {
  it("accepts a correct Bearer token", () => {
    expect(isAuthorizedBearerToken(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedBearerToken(null, SECRET)).toBe(false);
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(isAuthorizedBearerToken(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedBearerToken(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    const wrong = "x".repeat(SECRET.length);
    expect(isAuthorizedBearerToken(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of a different length", () => {
    expect(isAuthorizedBearerToken("Bearer short", SECRET)).toBe(false);
  });

  it("rejects an empty Bearer token", () => {
    expect(isAuthorizedBearerToken("Bearer ", SECRET)).toBe(false);
  });

  it("never throws on a secret with unusual characters", () => {
    const unicodeSecret = "sécrét-🔒-value";
    expect(isAuthorizedBearerToken(`Bearer ${unicodeSecret}`, unicodeSecret)).toBe(true);
  });
});
