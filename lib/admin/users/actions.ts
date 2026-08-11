"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";

/**
 * Minimal ADMIN-only user-management actions: create, role change,
 * activate/deactivate, and mfaRequired toggle. Every action independently
 * re-checks `isAdmin()` rather than trusting a page already did (see
 * CLAUDE.md, section 4.4 — Server Actions are directly invokable). Never
 * exposes `passwordHash`, `totpSecretEncrypted`, or recovery-code data;
 * every write is audited with non-sensitive metadata only.
 */

const ACCESS_DENIED = "Not found or access denied.";
const ROLE_VALUES = ["ADMIN", "ATTORNEY", "PARALEGAL", "STAFF"] as const;

/**
 * "Last usable admin" = last currently-active ADMIN. Blocks demoting or
 * deactivating that account so the firm never ends up with zero admins and
 * no way back in — a self-inflicted lockout with no admin-assisted
 * recovery path (there's no one left to assist).
 */
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: excludeUserId } } });
}

/** A random, URL-safe temporary password — never chosen by the admin, shown to them exactly once. */
function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

export type CreateUserResult =
  | { status: "error"; message: string }
  | { status: "success"; userId: string; temporaryPassword: string };

const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  role: z.enum(ROLE_VALUES),
  mfaRequired: z.boolean(),
});

export async function createUser(
  _prevState: CreateUserResult | undefined,
  formData: FormData,
): Promise<CreateUserResult> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) {
    return { status: "error", message: ACCESS_DENIED };
  }

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    mfaRequired: formData.get("mfaRequired") === "on",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { status: "error", message: "A user with that email already exists." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
      mfaRequired: parsed.data.mfaRequired,
      mustChangePassword: true,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, mfaRequired: user.mfaRequired },
    },
  });
  revalidatePath("/admin/users");

  return { status: "success", userId: user.id, temporaryPassword };
}

export async function setUserRole(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) return ACCESS_DENIED;

  const userId = formData.get("userId");
  const role = formData.get("role");
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof role !== "string" ||
    !(ROLE_VALUES as readonly string[]).includes(role)
  ) {
    return "Invalid request.";
  }
  if (userId === admin.id) {
    return "Role changes for your own account aren't available here.";
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return ACCESS_DENIED;
  if (target.role === role) return undefined;

  if (target.role === "ADMIN" && target.active && role !== "ADMIN") {
    if ((await countOtherActiveAdmins(target.id)) === 0) {
      return "Cannot change role: this is the last active admin.";
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { role: role as UserRole } });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "role", from: target.role, to: role },
    },
  });
  revalidatePath("/admin/users");
}

export async function setUserActive(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) return ACCESS_DENIED;

  const userId = formData.get("userId");
  const activeValue = formData.get("active");
  if (typeof userId !== "string" || !userId || (activeValue !== "true" && activeValue !== "false")) {
    return "Invalid request.";
  }
  if (userId === admin.id) {
    return "You cannot deactivate your own account here.";
  }
  const active = activeValue === "true";

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return ACCESS_DENIED;
  if (target.active === active) return undefined;

  if (target.role === "ADMIN" && target.active && !active) {
    if ((await countOtherActiveAdmins(target.id)) === 0) {
      return "Cannot deactivate: this is the last active admin.";
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { active } });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "active", from: target.active, to: active },
    },
  });
  revalidatePath("/admin/users");
}

export async function setUserMfaRequired(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) return ACCESS_DENIED;

  const userId = formData.get("userId");
  const requiredValue = formData.get("mfaRequired");
  if (typeof userId !== "string" || !userId || (requiredValue !== "true" && requiredValue !== "false")) {
    return "Invalid request.";
  }
  const mfaRequired = requiredValue === "true";

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return ACCESS_DENIED;
  if (target.mfaRequired === mfaRequired) return undefined;

  await prisma.user.update({ where: { id: userId }, data: { mfaRequired } });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "mfaRequired", from: target.mfaRequired, to: mfaRequired },
    },
  });
  revalidatePath("/admin/users");
}
