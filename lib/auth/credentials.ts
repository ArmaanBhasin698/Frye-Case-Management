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
  };
}
