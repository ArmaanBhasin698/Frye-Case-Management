import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// `auth()` in Auth.js v5 middleware mode wraps a callback and supplies
// `req.auth` itself; mocking it as the identity function lets this test
// drive the actual gating logic in proxy.ts with a hand-built `req`,
// without needing a real NextAuth request/session pipeline.
vi.mock("@/lib/auth/config", () => ({ auth: (callback: (req: unknown) => unknown) => callback }));

const proxyModule = await import("@/proxy");
const middleware = proxyModule.default as unknown as (req: {
  auth: unknown;
  nextUrl: { pathname: string; origin: string; searchParams: URLSearchParams };
}) => unknown;

function makeReq(pathname: string, auth: unknown) {
  return {
    auth,
    nextUrl: {
      pathname,
      origin: "http://localhost:3000",
      searchParams: new URLSearchParams(),
    },
  };
}

describe("proxy route gate — no direct-URL bypass of authentication", () => {
  it("redirects an unauthenticated request to any protected route to /login", () => {
    const response = middleware(makeReq("/matters/matter-1", null)) as InstanceType<typeof NextResponse>;
    expect(response.headers.get("location")).toContain("/login");
  });

  it("redirects an unauthenticated request to /account/security (MFA management) to /login too", () => {
    const response = middleware(makeReq("/account/security", null)) as InstanceType<typeof NextResponse>;
    expect(response.headers.get("location")).toContain("/login");
  });

  it("lets an unauthenticated request through to /login/mfa — the challenge page itself gates on its own signed ticket, not a session", () => {
    const response = middleware(makeReq("/login/mfa", null));
    expect(response).toBeInstanceOf(NextResponse);
    expect((response as InstanceType<typeof NextResponse>).headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated request through to /login/mfa/setup for the same reason", () => {
    const response = middleware(makeReq("/login/mfa/setup", null));
    expect((response as InstanceType<typeof NextResponse>).headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated request through to /login/change-password — reached pre-session, no ticket needed", () => {
    const response = middleware(makeReq("/login/change-password", null));
    expect((response as InstanceType<typeof NextResponse>).headers.get("location")).toBeNull();
  });

  it("still requires a real session for a route that only starts with /login/change-password as a string", () => {
    const response = middleware(makeReq("/login/change-password-not-real", null)) as InstanceType<
      typeof NextResponse
    >;
    expect(response.headers.get("location")).toContain("/login");
  });

  it("lists api/health in the matcher's exclusion pattern, so this middleware never runs on it at all", () => {
    // The middleware body itself has no notion of "which paths it runs
    // on" — that's decided entirely by this exported matcher before Next
    // ever invokes the handler above (Next.js's own routing applies it).
    // A health probe has no session cookie to send, so it must never
    // reach the isLoggedIn/isLoginPage logic in the first place.
    const [pattern] = proxyModule.config.matcher;
    expect(pattern).toContain("api/health");
  });

  it("still requires a real session for every other route — /login/mfa is not a wildcard bypass", () => {
    const response = middleware(makeReq("/login/mfax-not-a-real-mfa-route", null)) as InstanceType<
      typeof NextResponse
    >;
    // Deliberately NOT matched by the /login/mfa prefix check in a way that
    // would open up unrelated routes — this one starts with "/login/mfa"
    // as a string but isn't actually part of the MFA flow, so confirm the
    // matcher is scoped to real behavior rather than a loose prefix bug.
    expect(response.headers.get("location")).toContain("/login");
  });

  it("allows an authenticated request through to a protected route", () => {
    const response = middleware(makeReq("/matters/matter-1", { user: { id: "user-1" } }));
    expect((response as InstanceType<typeof NextResponse>).headers.get("location")).toBeNull();
  });

  it("redirects an already-authenticated user away from /login (and the MFA pages) back to the app", () => {
    const response = middleware(makeReq("/login", { user: { id: "user-1" } })) as InstanceType<typeof NextResponse>;
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
