/**
 * Refuses to let prisma/seed.ts run anywhere except local development or
 * the test runner. Seeding wipes every table before reseeding fictional
 * data (see prisma/seed.ts) — there was previously no guard at all against
 * running it against a real database. Allowlisted rather than
 * denylisted on purpose: refuse anything that isn't exactly
 * "development" or "test", including an unset NODE_ENV, rather than only
 * refusing the literal string "production" — a misconfigured production
 * host with NODE_ENV unset must still be refused.
 */

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

export function assertSeedAllowed(env: { NODE_ENV?: string } = process.env): void {
  const current = env.NODE_ENV;
  if (!current || !ALLOWED_ENVIRONMENTS.has(current)) {
    throw new Error(
      `Refusing to run: NODE_ENV is ${current ? `"${current}"` : "unset"}, not "development" or "test". ` +
        "prisma/seed.ts wipes and reseeds fictional data and must never run against a real database.",
    );
  }
}
