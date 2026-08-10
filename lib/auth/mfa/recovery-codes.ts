import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db";

const CODE_COUNT = 10;
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;
// No 0/O, 1/I/L — avoids characters that are easy to transcribe wrong by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  const bytes = randomBytes(GROUP_LENGTH * GROUP_COUNT);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** Fresh plaintext codes for one enrollment/reset. Show once; never persist as-is. */
export function generateRecoveryCodes(count: number = CODE_COUNT): string[] {
  return Array.from({ length: count }, randomCode);
}

/** Replaces all of a user's recovery codes with hashes of `plaintextCodes`, in one transaction. */
export async function replaceRecoveryCodes(userId: string, plaintextCodes: string[]): Promise<void> {
  const hashes = await Promise.all(plaintextCodes.map((code) => bcrypt.hash(normalize(code), 10)));
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
  ]);
}

/**
 * Checks `submitted` against `userId`'s unused recovery codes. On a match,
 * atomically flips that single row to used=true (`WHERE used = false`
 * guard) so it can never be redeemed again, even by a concurrent request
 * racing on the same code.
 */
export async function verifyAndConsumeRecoveryCode(userId: string, submitted: string): Promise<boolean> {
  const normalized = normalize(submitted);
  const candidates = await prisma.mfaRecoveryCode.findMany({
    where: { userId, used: false },
    select: { id: true, codeHash: true },
  });

  for (const candidate of candidates) {
    if (await bcrypt.compare(normalized, candidate.codeHash)) {
      const consumed = await prisma.mfaRecoveryCode.updateMany({
        where: { id: candidate.id, used: false },
        data: { used: true, usedAt: new Date() },
      });
      return consumed.count === 1;
    }
  }
  return false;
}
