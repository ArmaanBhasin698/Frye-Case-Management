import { randomBytes } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * One-time production bootstrap: creates the very first ADMIN account on a
 * freshly migrated database. Every other account-creation path requires an
 * existing ADMIN to act — self-registration (lib/auth/signup.ts) lands in
 * PENDING and needs ADMIN approval, and admin-created accounts
 * (lib/admin/users/actions.ts#createUser) are themselves ADMIN-only.
 * Seeding is deliberately blocked outside development/test
 * (lib/db/seed-guard.ts), so on a fresh production database there is
 * otherwise no way to reach the app's first admin without hand-editing the
 * database, which CLAUDE.md forbids.
 *
 * Invoked only from scripts/bootstrap-admin.ts (a standalone CLI, never an
 * HTTP route). Refuses if any ADMIN row already exists, regardless of
 * status — once one admin has ever existed, further account creation
 * belongs to the normal ADMIN-driven paths (Admin > Users), not this
 * script.
 */

const bootstrapAdminSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
});

export type BootstrapAdminInput = { name: unknown; email: unknown };

export type BootstrapAdminResult =
  | { status: "error"; message: string }
  | { status: "success"; userId: string; email: string; temporaryPassword: string };

/** Same convention as lib/admin/users/actions.ts#generateTemporaryPassword — a random, URL-safe temporary password never chosen by an operator, shown once. */
function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

export async function bootstrapAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const parsed = bootstrapAdminSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existingAdminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  if (existingAdminCount > 0) {
    return {
      status: "error",
      message:
        "Refusing to run: an ADMIN account already exists. Use Admin > Users in the app to create further accounts.",
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { status: "error", message: "A user with that email already exists." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: true,
      },
    });
  } catch (error) {
    // Guards the race between the findUnique check above and this create,
    // same as lib/admin/users/actions.ts#createUser and
    // lib/auth/signup.ts#registerAccount.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "A user with that email already exists." };
    }
    throw error;
  }

  // No authenticated actor exists for a bootstrap script — actorId is
  // null, the same convention lib/auth/signup.ts, lib/intake/ingest.ts, and
  // lib/telephony/ingest.ts already use for unattended writes. Never the
  // password or its hash in metadata.
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      metadata: { role: "ADMIN", source: "bootstrap_script" },
    },
  });

  return { status: "success", userId: user.id, email: user.email, temporaryPassword };
}
