import { prisma } from "@/lib/db";

/**
 * Read-only user list for the admin user-management page
 * (app/(dashboard)/admin/users). Callers must have already enforced
 * `assertIsAdmin` on the current session (see CLAUDE.md, section 4.4) —
 * this mirrors every other queries.ts in the app (e.g. lib/matters/queries.ts),
 * which trust the page-level assert rather than re-checking here.
 *
 * Deliberately selects only fields safe to display to an admin: never
 * `passwordHash`, never `totpSecretEncrypted`, never anything from
 * `MfaRecoveryCode`. MFA status is surfaced as the `mfaEnabled`/
 * `mfaRequired` booleans only — enough to act on, nothing that could be
 * used to reconstruct a secret.
 */
export type AdminUserSummary = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "ATTORNEY" | "PARALEGAL" | "STAFF";
  active: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  createdAt: Date;
};

export async function listUsersForAdmin(): Promise<AdminUserSummary[]> {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      mfaEnabled: true,
      mfaRequired: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
}
