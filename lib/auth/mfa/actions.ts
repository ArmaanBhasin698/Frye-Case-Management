"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";

import { prisma } from "@/lib/db";
import { signIn } from "@/lib/auth/config";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { verifyPassword } from "@/lib/auth/credentials";
import {
  clearEnrollmentTicket,
  clearPendingTicket,
  completeChallenge,
  consumeEnrollmentTicket,
  createEnrollmentTicket,
  readEnrollmentTicket,
  readPendingTicket,
} from "@/lib/auth/mfa/tickets";
import { buildOtpAuthUri, generateTotpSecret, verifyAndConsumeTotp, verifyEnrollmentCode } from "@/lib/auth/mfa/totp";
import { decryptSecret, encryptSecret } from "@/lib/auth/mfa/crypto";
import {
  generateRecoveryCodes,
  replaceRecoveryCodes,
  verifyAndConsumeRecoveryCode,
} from "@/lib/auth/mfa/recovery-codes";
import { isLockedOut, recordFailedMfaAttempt, resetMfaAttempts } from "@/lib/auth/mfa/lockout";

/**
 * Server Actions backing every MFA surface: the login-time challenge
 * (already-enrolled user), forced pre-session enrollment
 * (mfaRequired && !mfaEnabled), self-service enrollment/disable from an
 * already-authenticated session, and recovery-code regeneration. Every
 * action re-derives "who is this" from a server-verified source (the
 * signed challenge ticket, or requireCurrentUser()) — never from a
 * client-supplied id — and every second-factor check goes through the
 * atomic, single-use primitives in lib/auth/mfa/{totp,recovery-codes,tickets}.ts.
 */

export type ConfirmEnrollmentResult =
  | { status: "error"; message: string }
  | { status: "success"; recoveryCodes: string[] };

function isTotpFormat(code: string): boolean {
  return /^\d{6,8}$/.test(code.trim());
}

async function verifySecondFactor(
  userId: string,
  encryptedSecret: string,
  lastUsedStep: number | null,
  submitted: string,
): Promise<boolean> {
  const trimmed = submitted.trim();
  return isTotpFormat(trimmed)
    ? verifyAndConsumeTotp(userId, encryptedSecret, lastUsedStep, trimmed)
    : verifyAndConsumeRecoveryCode(userId, trimmed);
}

async function auditMfaEvent(
  userId: string,
  metadata: Record<string, string | number | boolean>,
): Promise<void> {
  await prisma.auditEvent.create({
    data: { actorId: userId, action: "UPDATE", entityType: "User", entityId: userId, metadata },
  });
}

async function completeSignInWithTicket(userId: string, pendingTicketId: string, callbackUrl: string) {
  const verifiedTicketId = await completeChallenge(pendingTicketId, userId);
  await clearPendingTicket();
  await signIn("mfa-complete", { ticket: verifiedTicketId, redirectTo: callbackUrl });
}

// --- Login challenge (already-enrolled user, /login/mfa) -------------------

export async function verifyMfaChallenge(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const code = formData.get("code");
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";
  if (typeof code !== "string" || code.trim().length === 0) {
    return "Enter your authenticator code or a recovery code.";
  }

  const pending = await readPendingTicket();
  if (!pending) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.active || !user.mfaEnabled || !user.totpSecretEncrypted) {
    await clearPendingTicket();
    redirect("/login");
  }

  if (await isLockedOut(user.id)) {
    return "Too many failed attempts. Try again in a few minutes.";
  }

  const verified = await verifySecondFactor(user.id, user.totpSecretEncrypted, user.totpLastUsedStep, code);
  if (!verified) {
    await recordFailedMfaAttempt(user.id);
    return "Invalid or already-used code.";
  }

  await resetMfaAttempts(user.id);

  try {
    await completeSignInWithTicket(user.id, pending.id, callbackUrl);
  } catch (error) {
    if (error instanceof AuthError) {
      return "Something went wrong completing sign-in. Please try again.";
    }
    throw error;
  }
}

// --- Forced enrollment (mfaRequired && !mfaEnabled, pre-session) -----------

export async function getForcedEnrollmentSetup(): Promise<{ otpauthUri: string; secret: string } | null> {
  const pending = await readPendingTicket();
  if (!pending) return null;

  const user = await prisma.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.active || user.mfaEnabled) return null;

  const existing = await readEnrollmentTicket(user.id);
  if (existing) {
    const secret = decryptSecret(existing.encryptedSecret);
    return { otpauthUri: buildOtpAuthUri(secret, user.email), secret };
  }

  const secret = generateTotpSecret();
  await createEnrollmentTicket(user.id, encryptSecret(secret));
  return { otpauthUri: buildOtpAuthUri(secret, user.email), secret };
}

export async function confirmForcedEnrollment(
  _prevState: ConfirmEnrollmentResult | undefined,
  formData: FormData,
): Promise<ConfirmEnrollmentResult> {
  const code = formData.get("code");
  if (typeof code !== "string" || code.trim().length === 0) {
    return { status: "error", message: "Enter the 6-digit code from your authenticator app." };
  }

  const pending = await readPendingTicket();
  if (!pending) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.active) {
    await clearPendingTicket();
    redirect("/login");
  }
  if (user.mfaEnabled) {
    redirect("/login/mfa");
  }

  if (await isLockedOut(user.id)) {
    return { status: "error", message: "Too many failed attempts. Try again in a few minutes." };
  }

  const enrollment = await readEnrollmentTicket(user.id);
  if (!enrollment) {
    return { status: "error", message: "Your setup session expired. Refresh the page to get a new code." };
  }

  const secret = decryptSecret(enrollment.encryptedSecret);
  const step = await verifyEnrollmentCode(secret, code.trim());
  if (step === null) {
    await recordFailedMfaAttempt(user.id);
    return { status: "error", message: "Invalid code. Check the time on your device and try again." };
  }

  const consumed = await consumeEnrollmentTicket(enrollment.id, user.id);
  if (!consumed) {
    return { status: "error", message: "Your setup session expired. Refresh the page to get a new code." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      totpSecretEncrypted: enrollment.encryptedSecret,
      totpLastUsedStep: step,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  const recoveryCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(user.id, recoveryCodes);
  await clearEnrollmentTicket();
  await auditMfaEvent(user.id, { event: "mfa_enrolled", recoveryCodesGenerated: recoveryCodes.length });

  return { status: "success", recoveryCodes };
}

/** Called once the user has acknowledged their recovery codes, to actually complete sign-in. */
export async function finishForcedEnrollment(formData: FormData): Promise<void> {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";
  const pending = await readPendingTicket();
  if (!pending) {
    redirect("/login");
  }
  await completeSignInWithTicket(pending.userId, pending.id, callbackUrl);
}

// --- Self-service enrollment (already authenticated, /account/security) ---

export async function getSelfEnrollmentSetup(): Promise<{ otpauthUri: string; secret: string } | null> {
  const user = await requireCurrentUser();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || dbUser.mfaEnabled) return null;

  const existing = await readEnrollmentTicket(user.id);
  if (existing) {
    const secret = decryptSecret(existing.encryptedSecret);
    return { otpauthUri: buildOtpAuthUri(secret, dbUser.email), secret };
  }

  const secret = generateTotpSecret();
  await createEnrollmentTicket(user.id, encryptSecret(secret));
  return { otpauthUri: buildOtpAuthUri(secret, dbUser.email), secret };
}

export async function confirmSelfEnrollment(
  _prevState: ConfirmEnrollmentResult | undefined,
  formData: FormData,
): Promise<ConfirmEnrollmentResult> {
  const user = await requireCurrentUser();
  const code = formData.get("code");
  if (typeof code !== "string" || code.trim().length === 0) {
    return { status: "error", message: "Enter the 6-digit code from your authenticator app." };
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    redirect("/login");
  }
  if (dbUser.mfaEnabled) {
    return { status: "error", message: "MFA is already enabled on this account." };
  }
  if (await isLockedOut(user.id)) {
    return { status: "error", message: "Too many failed attempts. Try again in a few minutes." };
  }

  const enrollment = await readEnrollmentTicket(user.id);
  if (!enrollment) {
    return { status: "error", message: "Your setup session expired. Refresh the page to get a new code." };
  }

  const secret = decryptSecret(enrollment.encryptedSecret);
  const step = await verifyEnrollmentCode(secret, code.trim());
  if (step === null) {
    await recordFailedMfaAttempt(user.id);
    return { status: "error", message: "Invalid code. Check the time on your device and try again." };
  }

  const consumed = await consumeEnrollmentTicket(enrollment.id, user.id);
  if (!consumed) {
    return { status: "error", message: "Your setup session expired. Refresh the page to get a new code." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      totpSecretEncrypted: enrollment.encryptedSecret,
      totpLastUsedStep: step,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  const recoveryCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(user.id, recoveryCodes);
  await clearEnrollmentTicket();
  await auditMfaEvent(user.id, { event: "mfa_enrolled", recoveryCodesGenerated: recoveryCodes.length });
  revalidatePath("/account/security");

  return { status: "success", recoveryCodes };
}

// --- Disable / regenerate (already authenticated, re-auth required) -------

export async function disableMfa(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const user = await requireCurrentUser();
  const password = formData.get("password");
  const code = formData.get("code");
  if (typeof password !== "string" || typeof code !== "string" || !password || !code) {
    return "Enter your password and a current code to disable MFA.";
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.active) {
    redirect("/login");
  }
  if (!dbUser.mfaEnabled || !dbUser.totpSecretEncrypted) {
    return "MFA is not enabled on this account.";
  }

  const verifiedPassword = await verifyPassword(dbUser.email, password);
  if (!verifiedPassword) {
    return "Incorrect password.";
  }
  if (await isLockedOut(user.id)) {
    return "Too many failed attempts. Try again in a few minutes.";
  }

  const verified = await verifySecondFactor(user.id, dbUser.totpSecretEncrypted, dbUser.totpLastUsedStep, code);
  if (!verified) {
    await recordFailedMfaAttempt(user.id);
    return "Invalid or already-used code.";
  }

  await resetMfaAttempts(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, totpSecretEncrypted: null, totpLastUsedStep: null },
  });
  await prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
  await auditMfaEvent(user.id, { event: "mfa_disabled" });
  revalidatePath("/account/security");
}

export async function regenerateRecoveryCodes(
  _prevState: ConfirmEnrollmentResult | undefined,
  formData: FormData,
): Promise<ConfirmEnrollmentResult> {
  const user = await requireCurrentUser();
  const password = formData.get("password");
  const code = formData.get("code");
  if (typeof password !== "string" || typeof code !== "string" || !password || !code) {
    return { status: "error", message: "Enter your password and a current code to regenerate recovery codes." };
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.active) {
    redirect("/login");
  }
  if (!dbUser.mfaEnabled || !dbUser.totpSecretEncrypted) {
    return { status: "error", message: "MFA is not enabled on this account." };
  }

  const verifiedPassword = await verifyPassword(dbUser.email, password);
  if (!verifiedPassword) {
    return { status: "error", message: "Incorrect password." };
  }
  if (await isLockedOut(user.id)) {
    return { status: "error", message: "Too many failed attempts. Try again in a few minutes." };
  }

  const verified = await verifySecondFactor(user.id, dbUser.totpSecretEncrypted, dbUser.totpLastUsedStep, code);
  if (!verified) {
    await recordFailedMfaAttempt(user.id);
    return { status: "error", message: "Invalid or already-used code." };
  }

  await resetMfaAttempts(user.id);
  const recoveryCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(user.id, recoveryCodes);
  await auditMfaEvent(user.id, { event: "mfa_recovery_codes_regenerated" });
  revalidatePath("/account/security");

  return { status: "success", recoveryCodes };
}

// --- Admin-assisted reset (ADMIN only, re-auth required) -------------------

/**
 * Recovers an account that has lost both its authenticator and every
 * recovery code. Deliberately distinct from disableMfa/regenerateRecoveryCodes
 * above: those are self-service (a user proving they still hold their own
 * second factor); this is the path for when that's no longer possible, so
 * it substitutes a different party's authority (an ADMIN) instead — never
 * a bare authenticated session. The admin must re-prove their own identity
 * with their password, and their own current MFA code/recovery code if
 * they have MFA enabled, exactly as strictly as a self-service reset would
 * require of the account holder themselves. The target's previous TOTP
 * secret and recovery codes are never read back or exposed — they're wiped
 * and the account is forced into fresh enrollment (mfaRequired: true) on
 * its next login, never left in a "no MFA at all" state.
 */
export async function adminResetMfa(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) {
    return "Not found or access denied.";
  }

  const targetUserId = formData.get("userId");
  const adminPassword = formData.get("adminPassword");
  const adminCode = formData.get("adminCode");
  if (typeof targetUserId !== "string" || !targetUserId || typeof adminPassword !== "string" || !adminPassword) {
    return "Enter your password to confirm this reset.";
  }

  // Deliberately excluded: letting an admin use this path on their own
  // account would turn off MFA unilaterally with no second party involved,
  // defeating the point of gating this behind a *different* admin's
  // authority. Self-service reset (disableMfa, above) already covers a
  // voluntary reset of one's own MFA.
  if (targetUserId === admin.id) {
    return "Use Account Security to reset your own MFA.";
  }

  const adminRecord = await prisma.user.findUnique({ where: { id: admin.id } });
  if (!adminRecord || !adminRecord.active) {
    redirect("/login");
  }

  const verifiedPassword = await verifyPassword(adminRecord.email, adminPassword);
  if (!verifiedPassword) {
    return "Incorrect password.";
  }

  // An open authenticated session alone is not sufficient — if the admin
  // has MFA enabled, they must prove they still hold it right now, exactly
  // as strictly as disableMfa/regenerateRecoveryCodes require of any user
  // resetting their own MFA.
  if (adminRecord.mfaEnabled) {
    if (!adminRecord.totpSecretEncrypted) {
      return "Something is wrong with your own MFA setup. Please try again later.";
    }
    if (typeof adminCode !== "string" || !adminCode.trim()) {
      return "Enter your current authenticator or recovery code to confirm this reset.";
    }
    if (await isLockedOut(admin.id)) {
      return "Too many failed attempts on your own account. Try again in a few minutes.";
    }
    const verified = await verifySecondFactor(
      admin.id,
      adminRecord.totpSecretEncrypted,
      adminRecord.totpLastUsedStep,
      adminCode,
    );
    if (!verified) {
      await recordFailedMfaAttempt(admin.id);
      return "Invalid or already-used code.";
    }
    await resetMfaAttempts(admin.id);
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return "Not found or access denied.";
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      mfaEnabled: false,
      mfaRequired: true,
      totpSecretEncrypted: null,
      totpLastUsedStep: null,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  await prisma.mfaRecoveryCode.deleteMany({ where: { userId: target.id } });

  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "User",
      entityId: target.id,
      metadata: { event: "admin_mfa_reset" },
    },
  });
  revalidatePath("/admin/users");
}
