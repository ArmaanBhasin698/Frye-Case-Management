import { generateSecret, generateURI, verify } from "otplib";

import { prisma } from "@/lib/db";
import { decryptSecret } from "./crypto";

const ISSUER = "Frye Case Management";
// ±30s clock-skew tolerance either side of the current 30s step.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpAuthUri(secret: string, email: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

/** Used only at enrollment confirmation, before the account has any stored step to compare against. */
export async function verifyEnrollmentCode(secret: string, code: string): Promise<number | null> {
  const result = await verify({ secret, token: code.trim(), epochTolerance: EPOCH_TOLERANCE_SECONDS });
  // `verify()`'s return type also covers HOTP, which has no `timeStep` — this
  // module only ever uses the (default) TOTP strategy, so `valid` implies it.
  if (!result.valid || !("timeStep" in result)) return null;
  return result.timeStep;
}

/**
 * Verifies `code` against `userId`'s stored TOTP secret and atomically
 * records the consumed time-step, so a captured still-valid code can't be
 * replayed within its own window — including by a concurrent request. The
 * library's own `afterTimeStep` option already rejects steps at or before
 * `lastUsedStep`; the `WHERE totpLastUsedStep < result.timeStep` guard on
 * the update makes the actual consumption a single conditional write, not
 * a read-then-write race, so two concurrent requests replaying the same
 * code can't both succeed even if both passed `verify()`.
 */
export async function verifyAndConsumeTotp(
  userId: string,
  encryptedSecret: string,
  lastUsedStep: number | null,
  code: string,
): Promise<boolean> {
  const secret = decryptSecret(encryptedSecret);
  const result = await verify({
    secret,
    token: code.trim(),
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
    ...(lastUsedStep !== null ? { afterTimeStep: lastUsedStep } : {}),
  });
  if (!result.valid || !("timeStep" in result)) return false;

  const updated = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: result.timeStep } }],
    },
    data: { totpLastUsedStep: result.timeStep },
  });
  return updated.count === 1;
}
