import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";

export type VerifiedCredentialsUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  mustChangePassword: boolean;
};

/**
 * First-factor (password) check, shared by the Credentials provider's
 * `authorize()` (lib/auth/config.ts) and the login Server Action
 * (app/(auth)/login/actions.ts) — one place decides "is this password
 * right for this active account," so the two callers can't drift.
 */
export async function verifyPassword(email: string, password: string): Promise<VerifiedCredentialsUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return null;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    mfaRequired: user.mfaRequired,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Whether the plain "credentials" Auth.js provider may complete sign-in
 * for an already-password-verified user — refuses whenever any
 * pre-session gate still applies (a pending password change, or MFA
 * enrolled/required). Named and exported so this exact refusal condition
 * is unit-testable on its own (see tests/auth/credentials.test.ts)
 * without needing to invoke NextAuth's own provider machinery — the
 * refusal itself, not any UI routing, is what actually prevents a
 * password-only session for such an account, regardless of how sign-in
 * was attempted (see lib/auth/config.ts#authorize).
 */
export function canCompleteCredentialsSignIn(user: VerifiedCredentialsUser): boolean {
  return !user.mfaEnabled && !user.mfaRequired && !user.mustChangePassword;
}
