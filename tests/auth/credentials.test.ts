import { describe, expect, it } from "vitest";

import { canCompleteCredentialsSignIn } from "@/lib/auth/credentials";
import type { VerifiedCredentialsUser } from "@/lib/auth/credentials";

function user(overrides: Partial<VerifiedCredentialsUser> = {}): VerifiedCredentialsUser {
  return {
    id: "user-1",
    name: "Demo User",
    email: "demo.user@fryelawgroup.example",
    role: "STAFF",
    mfaEnabled: false,
    mfaRequired: false,
    mustChangePassword: false,
    ...overrides,
  };
}

describe("canCompleteCredentialsSignIn — the actual server-side bypass guard", () => {
  it("allows a plain account with no pending gates", () => {
    expect(canCompleteCredentialsSignIn(user())).toBe(true);
  });

  it("refuses an account with mfaEnabled — no direct-request bypass of MFA", () => {
    expect(canCompleteCredentialsSignIn(user({ mfaEnabled: true }))).toBe(false);
  });

  it("refuses an account with mfaRequired but not yet enrolled", () => {
    expect(canCompleteCredentialsSignIn(user({ mfaRequired: true }))).toBe(false);
  });

  it("refuses an account with mustChangePassword — no direct-request bypass of the password-change requirement", () => {
    expect(canCompleteCredentialsSignIn(user({ mustChangePassword: true }))).toBe(false);
  });

  it("refuses when multiple gates apply at once", () => {
    expect(canCompleteCredentialsSignIn(user({ mustChangePassword: true, mfaEnabled: true }))).toBe(false);
  });
});
