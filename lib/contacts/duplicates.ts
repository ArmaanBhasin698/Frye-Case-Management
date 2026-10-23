import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Duplicate-contact detection for the create form. Candidates are only
 * ever drawn from contacts the current user can already see (the caller
 * passes its visibility filter) — a warning must never reveal that a
 * restricted person exists elsewhere in the firm (see
 * docs/FIRM_OPERATIONS_EXPANSION.md, section 4.1).
 */

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  // Treat a leading US country code as insignificant so "+1 555 0100" matches "555-0100".
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export type DuplicateProbe = {
  displayName: string;
  emails: string[];
  phones: string[];
};

export type DuplicateCandidateRow = {
  id: string;
  displayName: string;
  emails: { address: string }[];
  phones: { number: string }[];
};

export type DuplicateMatch = { id: string; displayName: string; reasons: ("name" | "email" | "phone")[] };

/** Pure: which already-fetched candidates genuinely match, and why. */
export function classifyDuplicates(probe: DuplicateProbe, candidates: DuplicateCandidateRow[]): DuplicateMatch[] {
  const name = normalizeName(probe.displayName);
  const emails = new Set(probe.emails.map((e) => e.trim().toLowerCase()));
  const phones = new Set(probe.phones.map(phoneDigits).filter((d) => d.length >= 7));

  const matches: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    const reasons: DuplicateMatch["reasons"] = [];
    if (name && normalizeName(candidate.displayName) === name) reasons.push("name");
    if (candidate.emails.some((e) => emails.has(e.address.toLowerCase()))) reasons.push("email");
    if (candidate.phones.some((p) => phones.has(phoneDigits(p.number)))) reasons.push("phone");
    if (reasons.length > 0) matches.push({ id: candidate.id, displayName: candidate.displayName, reasons });
  }
  return matches;
}

/**
 * Coarse database prefilter (exact-insensitive name, exact email, or a
 * phone sharing the last four digits), refined by `classifyDuplicates`.
 * `excludeId` skips the contact being edited.
 */
export async function findDuplicateContacts(
  probe: DuplicateProbe,
  visibility: Prisma.ContactWhereInput,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const or: Prisma.ContactWhereInput[] = [];
  if (probe.displayName.trim()) {
    or.push({ displayName: { equals: probe.displayName.trim(), mode: "insensitive" } });
  }
  const emails = probe.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length > 0) {
    or.push({ emails: { some: { address: { in: emails, mode: "insensitive" } } } });
  }
  const lastFours = [...new Set(probe.phones.map(phoneDigits).filter((d) => d.length >= 7).map((d) => d.slice(-4)))];
  for (const lastFour of lastFours) {
    or.push({ phones: { some: { number: { endsWith: lastFour } } } });
  }
  if (or.length === 0) return [];

  const conditions: Prisma.ContactWhereInput[] = [visibility, { OR: or }];
  if (excludeId) conditions.push({ id: { not: excludeId } });

  const candidates = await prisma.contact.findMany({
    where: { AND: conditions },
    select: { id: true, displayName: true, emails: { select: { address: true } }, phones: { select: { number: true } } },
    take: 20,
  });
  return classifyDuplicates(probe, candidates);
}
