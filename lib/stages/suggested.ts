import type { PrismaClient } from "@prisma/client";

/** Suggested criminal-defense progress stages (editable after install). */
export const SUGGESTED_STAGES = [
  "Investigation",
  "Discovery",
  "Motions",
  "Trial Preparation",
  "Trial",
  "Post-Disposition",
] as const;

/**
 * Idempotently installs the suggested stages: any suggested name that
 * doesn't already exist (case-insensitive, archived or not) is appended
 * after the current last position. Existing stages are never renamed,
 * reordered, or restored. Usable from prisma/seed.ts and the admin page.
 * Returns the names actually created.
 */
export async function ensureSuggestedStages(db: Pick<PrismaClient, "matterStage">): Promise<string[]> {
  const existing = await db.matterStage.findMany({ select: { name: true, position: true } });
  const names = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  let position = existing.reduce((max, s) => Math.max(max, s.position), 0);
  const created: string[] = [];
  for (const name of SUGGESTED_STAGES) {
    if (names.has(name.toLowerCase())) continue;
    position += 1;
    await db.matterStage.create({ data: { name, position } });
    created.push(name);
  }
  return created;
}
