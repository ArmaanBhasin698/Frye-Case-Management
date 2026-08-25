"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { UserRole, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";

/**
 * ADMIN-only user-management actions: create, approve a self-registered
 * account, role change, activate/deactivate/reactivate, password reset,
 * and archive/delete. Every action independently re-checks `isAdmin()`
 * rather than trusting a page already did (see CLAUDE.md, section 4.4 —
 * Server Actions are directly invokable). Never exposes `passwordHash`,
 * `totpSecretEncrypted`, or recovery-code data; every write is audited
 * with non-sensitive metadata only.
 */

const ACCESS_DENIED = "Not found or access denied.";
const ROLE_VALUES = ["ADMIN", "ATTORNEY", "PARALEGAL", "STAFF"] as const;

/**
 * "Last usable admin" = last currently-ACTIVE ADMIN. Blocks demoting,
 * deactivating, or deleting/archiving that account so the firm never ends
 * up with zero admins and no way back in — a self-inflicted lockout with
 * no admin-assisted recovery path (there's no one left to assist).
 */
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE", id: { not: excludeUserId } } });
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

/**
 * ADMIN → Add Employee: creates an account directly (status ACTIVE — the
 * admin has already vetted this person, unlike a self-registered PENDING
 * account below) with a server-generated temporary password and
 * `mustChangePassword: true`. The admin never learns or stores the
 * employee's real password — this is the same "invite" mechanism this
 * codebase already had; nothing new was needed here.
 */
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

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
        status: "ACTIVE",
        mfaRequired: parsed.data.mfaRequired,
        mustChangePassword: true,
      },
    });
  } catch (error) {
    // Guards the race between the findUnique check above and this create —
    // two concurrent submissions for the same email can both pass that
    // check before either row exists. Without this, the loser surfaces a
    // raw Prisma constraint error (a stack trace) instead of the same
    // clean message the check above already gives the common case.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "A user with that email already exists." };
    }
    throw error;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, mfaRequired: user.mfaRequired, source: "admin_created" },
    },
  });
  revalidatePath("/admin/users");

  return { status: "success", userId: user.id, temporaryPassword };
}

const approveUserSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(ROLE_VALUES),
});

export type ApproveUserResult = { status: "error"; message: string } | { status: "success" };

/**
 * ADMIN approval of a self-registered (PENDING) account — the only path
 * that ever moves a self-registration into an authorized state. The admin
 * picks (or confirms) the role at approval time, since a self-registrant
 * never chose one themselves (lib/auth/signup.ts enforces that the
 * self-registration schema has no role field at all).
 */
export async function approveUser(
  _prevState: ApproveUserResult | undefined,
  formData: FormData,
): Promise<ApproveUserResult> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) {
    return { status: "error", message: ACCESS_DENIED };
  }

  const parsed = approveUserSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { userId, role } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { status: "error", message: ACCESS_DENIED };
  if (target.status !== "PENDING") {
    return { status: "error", message: "This account is not awaiting approval." };
  }

  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE", role } });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "status", from: "PENDING", to: "ACTIVE", role },
    },
  });
  revalidatePath("/admin/users");
  return { status: "success" };
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
  if (target.status === "PENDING") {
    return "This account is awaiting approval — use Approve to set its role and activate it.";
  }
  if (target.role === role) return undefined;

  if (target.role === "ADMIN" && target.status === "ACTIVE" && role !== "ADMIN") {
    if ((await countOtherActiveAdmins(target.id)) === 0) {
      return "Cannot change role: this is the last active admin.";
    }
  }

  // Not bumped: getCurrentUser() (lib/auth/session.ts) always reads role
  // fresh from the database on every request, so a role change already
  // takes effect on this account's very next request without needing to
  // end its current session outright — that's reserved for actual
  // deactivation/password/MFA resets below, where ending the session is
  // the entire point.
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

const STATUS_TRANSITION_VALUES = ["ACTIVE", "INACTIVE"] as const;

/**
 * Activate/deactivate/reactivate — deliberately never accepts `"PENDING"`
 * as a target: the only path into PENDING is self-registration, and the
 * only path out of it is `approveUser` above, which also assigns a role.
 */
export async function setUserStatus(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) return ACCESS_DENIED;

  const userId = formData.get("userId");
  const statusValue = formData.get("status");
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof statusValue !== "string" ||
    !(STATUS_TRANSITION_VALUES as readonly string[]).includes(statusValue)
  ) {
    return "Invalid request.";
  }
  if (userId === admin.id) {
    return "You cannot deactivate your own account here.";
  }
  const status = statusValue as UserStatus;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return ACCESS_DENIED;
  if (target.status === "PENDING") {
    return "This account is awaiting approval — use Approve instead.";
  }
  if (target.status === status) return undefined;

  if (target.role === "ADMIN" && target.status === "ACTIVE" && status !== "ACTIVE") {
    if ((await countOtherActiveAdmins(target.id)) === 0) {
      return "Cannot deactivate: this is the last active admin.";
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      status,
      // Deactivating ends this account's current session immediately
      // (see lib/auth/session.ts#getCurrentUser) rather than leaving it
      // valid for up to the JWT's remaining 12-hour lifetime. Reactivating
      // doesn't need this: there is no session to end.
      ...(status === "INACTIVE" ? { sessionInvalidatedAt: new Date() } : {}),
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "status", from: target.status, to: status },
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
  if (userId === admin.id) {
    return "MFA-required changes for your own account aren't available here.";
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

export type ResetPasswordResult =
  | { status: "error"; message: string }
  | { status: "success"; temporaryPassword: string };

/**
 * Admin-initiated password reset for an existing account — reuses
 * `createUser`'s exact mechanism (server-generated temp password,
 * `mustChangePassword: true`, shown to the admin exactly once, never
 * stored or logged). Also ends the account's current session immediately
 * (see lib/auth/session.ts#getCurrentUser): a credential reset is exactly
 * the kind of sensitive change that shouldn't leave an old session valid.
 */
export async function resetUserPassword(userId: string): Promise<ResetPasswordResult> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) {
    return { status: "error", message: ACCESS_DENIED };
  }
  if (userId === admin.id) {
    return { status: "error", message: "Use Account Security to change your own password." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { status: "error", message: ACCESS_DENIED };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: true, sessionInvalidatedAt: new Date() },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "password", reset: true },
    },
  });
  revalidatePath("/admin/users");

  return { status: "success", temporaryPassword };
}

/** Every User relation that must be empty before a true hard-delete is allowed — see docs/DATA_MODEL.md's account-deletion note. */
async function countUserHistoricalRelations(userId: string): Promise<number> {
  const counts = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      _count: {
        select: {
          assignments: true,
          assignedTasks: true,
          authoredNotes: true,
          uploadedDocuments: true,
          filedCalls: true,
          registeredDiscoveryFiles: true,
          ranDiscoveryComparisons: true,
          auditEvents: true,
          archivedClients: true,
          archivedMatters: true,
          mfaRecoveryCodes: true,
          mfaChallengeTickets: true,
          failedLoginAttempts: true,
          securityIncidents: true,
          reviewedIntakeLeads: true,
        },
      },
    },
  });
  if (!counts) return 0;
  return Object.values(counts._count).reduce((sum, n) => sum + n, 0);
}

export type RemoveUserResult = { status: "error"; message: string } | { status: "archived" | "deleted" };

/**
 * Safe account removal — never a blind hard delete (see
 * docs/DATA_MODEL.md). `User` has ~15 historical/audit relations
 * (MatterAssignment, authored Notes/Documents/Calls, AuditEvent, MFA
 * records, etc.); deleting a row those reference would either be blocked
 * by the database (a Restrict FK) or silently erase historical
 * accountability. So:
 *  - if the account has ANY such relation, it's archived instead:
 *    status -> INACTIVE (blocks login, same as ordinary deactivation),
 *    every MatterAssignment removed (so it stops appearing on any
 *    matter's team), everything it authored/audited/was assigned
 *    untouched.
 *  - only a genuinely never-used account (zero rows across every one of
 *    those relations — e.g. created by mistake, never logged in, never
 *    assigned to anything) is actually deleted.
 */
export async function removeUser(userId: string): Promise<RemoveUserResult> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) {
    return { status: "error", message: ACCESS_DENIED };
  }
  if (userId === admin.id) {
    return { status: "error", message: "You cannot remove your own account here." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { status: "error", message: ACCESS_DENIED };
  }

  if (target.role === "ADMIN" && target.status === "ACTIVE") {
    if ((await countOtherActiveAdmins(target.id)) === 0) {
      return { status: "error", message: "Cannot remove: this is the last active admin." };
    }
  }

  const historicalRelationCount = await countUserHistoricalRelations(userId);

  if (historicalRelationCount === 0) {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.auditEvent.create({
      data: {
        actorId: admin.id,
        action: "DELETE",
        entityType: "User",
        entityId: userId,
        metadata: { role: target.role },
      },
    });
    revalidatePath("/admin/users");
    return { status: "deleted" };
  }

  await prisma.$transaction([
    prisma.matterAssignment.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { status: "INACTIVE", sessionInvalidatedAt: new Date() },
    }),
  ]);
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      metadata: { field: "status", from: target.status, to: "INACTIVE", archived: true },
    },
  });
  revalidatePath("/admin/users");
  return { status: "archived" };
}
