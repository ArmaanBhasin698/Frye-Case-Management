"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Public self-registration — the only account-creation path with no
 * authenticated actor behind it. Every account this creates starts
 * `status: "PENDING"`: `verifyPassword` (lib/auth/credentials.ts) denies
 * login for any non-ACTIVE account, so a self-registered user cannot reach
 * any protected page or Server Action until an ADMIN approves it
 * (lib/admin/users/actions.ts#approveUser) — the exact same MFA/password
 * architecture as every other account, not a parallel one.
 *
 * `role` is deliberately not a field on this schema at all — there is no
 * form input this action ever reads to decide it, so a crafted request
 * cannot inject one. Every self-registered account is created as `STAFF`
 * (the schema's own least-privileged default), inert until an admin both
 * approves it and picks its real role at that time.
 *
 * Password policy matches the existing forced-password-change flow
 * (app/(auth)/login/change-password/actions.ts): 12+ characters, hashed
 * with the same bcrypt(10) this codebase already uses everywhere else —
 * no new hashing mechanism.
 */

const signupSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1, "Last name is required.").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid work email address.").max(200),
    password: z.string().min(12, "Password must be at least 12 characters.").max(200),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignUpResult = { status: "error"; message: string } | { status: "success" };

/**
 * Deliberately identical whether the email belongs to an existing
 * PENDING, ACTIVE, or INACTIVE account, or one of any role including
 * ADMIN — this form never reveals which. The unique-email constraint
 * itself is the only thing that can't be hidden (a real account has to
 * exist for this message to trigger), which is normal, unavoidable signup
 * behavior, not a new enumeration surface.
 */
const GENERIC_DUPLICATE_MESSAGE = "If this email already has an account, sign in instead or contact an administrator.";

export async function registerAccount(
  _prevState: SignUpResult | undefined,
  formData: FormData,
): Promise<SignUpResult> {
  const parsed = signupSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { status: "error", message: GENERIC_DUPLICATE_MESSAGE };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const name = `${parsed.data.firstName} ${parsed.data.lastName}`;

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name,
        email: parsed.data.email,
        passwordHash,
        role: "STAFF",
        status: "PENDING",
      },
    });
  } catch (error) {
    // Guards the race between the findUnique check above and this create,
    // same as lib/admin/users/actions.ts#createUser.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: GENERIC_DUPLICATE_MESSAGE };
    }
    throw error;
  }

  // No authenticated actor exists for a self-registration — actorId is
  // null, the same convention lib/intake/ingest.ts and
  // lib/telephony/ingest.ts already use for unattended writes.
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, source: "self_registered" },
    },
  });

  return { status: "success" };
}
