import { backfillClientContacts } from "@/lib/contacts/backfill";
import { prisma } from "@/lib/db";

/**
 * Development-only, re-runnable: links a Contact-directory entry to every
 * existing (fictional) Client that predates the Contacts module. Refuses
 * to run outside NODE_ENV=development/test.
 *
 *   NODE_ENV=development npx tsx scripts/backfill-client-contacts.ts
 */
async function main() {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    console.error(`Refusing to run: NODE_ENV is ${env ? `"${env}"` : "unset"}, not "development" or "test".`);
    process.exitCode = 1;
    return;
  }
  const { created, skipped } = await backfillClientContacts();
  console.log(`Client contacts created: ${created}; already present (skipped): ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
