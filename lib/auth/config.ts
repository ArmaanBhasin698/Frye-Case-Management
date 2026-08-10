import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/credentials";
import { consumeVerifiedTicket } from "@/lib/auth/mfa/tickets";

/**
 * Auth.js configuration for credentials-based, session-based auth (see
 * CLAUDE.md, section 3). Fictional development users only — see
 * prisma/seed.ts and docs/SECURITY.md. No OAuth/SSO provider is
 * configured; adding one later is additive here, not a rewrite.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Dev-only: lets Auth.js infer its own URL behind this environment's
  // proxy instead of requiring an exact AUTH_URL match. Revisit before any
  // real deployment (see docs/SECURITY.md).
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
      // Completes sign-in directly only for accounts with no MFA in play.
      // An account with mfaEnabled or mfaRequired set can NEVER complete
      // sign-in through this provider, no matter how the request was made
      // (the login form, a direct POST to the callback route, or anything
      // else) — that refusal, not any UI redirect, is what actually
      // prevents a password-only session for those accounts. See
      // lib/auth/mfa/ and the "mfa-complete" provider below.
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
        if (!user || user.mfaEnabled || user.mfaRequired) {
          return null;
        }

        return { id: user.id, name: user.name, email: user.email, role: user.role };
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
        if (!user || !user.active) {
          return null;
        }

        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
