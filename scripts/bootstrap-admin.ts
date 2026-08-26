import { bootstrapAdmin } from "@/lib/admin/bootstrapAdmin";
import { prisma } from "@/lib/db";

/**
 * One-time production bootstrap CLI — creates the first ADMIN account on a
 * freshly migrated database. See lib/admin/bootstrapAdmin.ts for the guard
 * and creation logic (refuses if any ADMIN already exists).
 *
 * Standalone CLI only — never an HTTP route, never invoked by
 * build/start/deploy. Run explicitly, once, directly against the target
 * database:
 *
 *   npm run bootstrap:admin -- --email you@example.com --name "Your Name"
 *
 * Prints the generated temporary password to this terminal exactly once —
 * it is never stored, logged elsewhere, or returned over HTTP. The new
 * account must change it on first login (mustChangePassword: true).
 */

function parseArgs(argv: string[]): { name?: string; email?: string } {
  const result: { name?: string; email?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") result.email = argv[++i];
    else if (arg === "--name") result.name = argv[++i];
    else if (arg?.startsWith("--email=")) result.email = arg.slice("--email=".length);
    else if (arg?.startsWith("--name=")) result.name = arg.slice("--name=".length);
  }
  return result;
}

async function main() {
  const { name, email } = parseArgs(process.argv.slice(2));
  if (!name || !email) {
    console.error('Usage: npm run bootstrap:admin -- --email <email> --name "<full name>"');
    process.exitCode = 1;
    return;
  }

  const result = await bootstrapAdmin({ name, email });

  if (result.status === "error") {
    console.error(`Bootstrap failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("Admin account created.");
  console.log(`  Email:              ${result.email}`);
  console.log(`  Temporary password: ${result.temporaryPassword}`);
  console.log("This password is shown once and is not stored anywhere. The account must change it on first login.");
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
