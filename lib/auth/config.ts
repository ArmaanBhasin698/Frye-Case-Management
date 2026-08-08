import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db";

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
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
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

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });
        if (!user || !user.active) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
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
