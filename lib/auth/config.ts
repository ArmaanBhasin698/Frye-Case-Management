import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/db";
import { canCompleteCredentialsSignIn, verifyPassword } from "@/lib/auth/credentials";
import { consumeVerifiedTicket } from "@/lib/auth/mfa/tickets";

/**
 * Auth.js configuration for credentials-based, session-based auth (see
 * CLAUDE.md, section 3). Fictional development users only — see
 * prisma/seed.ts and docs/SECURITY.md. No OAuth/SSO provider is
 * configured; adding one later is additive here, not a rewrite.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Dev-only: lets Auth.js infer its own URL from the incoming request's
  // Host header instead of requiring an exact AUTH_URL match — convenient
  // locally, but only safe in production if every request genuinely
  // reaches this process through a reverse proxy/host that itself
  // controls the Host header rather than passing through whatever a
  // client sent. Whether that's true depends entirely on the eventual
  // hosting platform, which hasn't been chosen — do not flip this or add
  // platform-specific logic here without first re-validating the exact
  // checklist in docs/SECURITY.md's "Authentication" section (trustHost
  // vs. an explicit AUTH_URL, and whether X-Forwarded-Host/Proto can be
  // trusted from that specific platform's edge).
  trustHost: true,
  // A privileged-case-data session shouldn't stay valid for next-auth's
  // 30-day JWT default. Shorter-lived sessions bound how long a stolen
  // cookie or a deactivated-but-not-yet-expired account remains usable —
  // see docs/SECURITY.md's "Known remaining risks" for why this isn't a
  // full fix (JWT sessions aren't revocable server-side before they
  // expire; that needs either a DB check on every request or a switch to
  // the database session strategy, deferred until real deployment).
  session: { strategy: "jwt", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      // Completes sign-in directly only for accounts with no MFA and no
      // pending password change in play. An account with mfaEnabled,
      // mfaRequired, or mustChangePassword set can NEVER complete sign-in
      // through this provider, no matter how the request was made (the
      // login form, a direct POST to the callback route, or anything
      // else) — that refusal, not any UI redirect, is what actually
      // prevents a password-only session for those accounts. See
      // lib/auth/mfa/, lib/auth/login-flow.ts, and the "mfa-complete"
      // provider below.
      id: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await verifyPassword(email, password);
        if (!user || !canCompleteCredentialsSignIn(user)) {
          return null;
        }

        return { id: user.id, name: user.name, email: user.email, role: user.role, sessionStamp: user.sessionStamp };
      },
    }),
    Credentials({
      // Internal, not surfaced on any login form. The only credential it
      // accepts is a challenge-ticket id, and that id can only ever
      // complete sign-in once (see consumeVerifiedTicket) and only after
      // lib/auth/mfa/actions.ts has already verified a real TOTP code or
      // recovery code for that ticket's user. A caller who invokes this
      // provider directly with a guessed/forged/expired/already-used
      // ticket id gets nothing — the ticket lookup is the entire check.
      id: "mfa-complete",
      credentials: {
        ticket: { label: "Ticket", type: "text" },
      },
      async authorize(credentials) {
        const ticket = credentials?.ticket;
        if (typeof ticket !== "string") {
          return null;
        }

        const consumed = await consumeVerifiedTicket(ticket);
        if (!consumed) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { id: consumed.userId } });
        if (!user || user.status !== "ACTIVE") {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionStamp: user.sessionInvalidatedAt?.getTime() ?? 0,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sessionStamp = user.sessionStamp;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.sessionStamp = token.sessionStamp;
      return session;
    },
  },
});
