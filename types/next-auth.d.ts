import type { UserRole } from "@prisma/client";

// Augments Auth.js's built-in types with the fields our jwt/session
// callbacks add (lib/auth/config.ts) — id and role, sourced from our own
// User table rather than an OAuth profile.
//
// These interfaces are declared in @auth/core/types and @auth/core/jwt;
// "next-auth" and "next-auth/jwt" only re-export them with `export type`,
// which TypeScript does not treat as the same merge target. Augmenting
// "next-auth" directly (as some older docs suggest) is a silent no-op —
// augment the @auth/core modules instead.
declare module "@auth/core/types" {
  interface User {
    id: string;
    role: UserRole;
    /** Epoch ms of User.sessionInvalidatedAt at sign-in time — see lib/auth/session.ts#getCurrentUser. */
    sessionStamp: number;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      sessionStamp: number;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    sessionStamp: number;
  }
}
