import { prisma } from "@/lib/db";
import { runNotificationScheduler } from "@/lib/notifications/scheduler";

/**
 * Development/test-only: runs one notification-scheduler pass against the
 * local database. Production runs go through the protected cron route
 * (app/api/cron/notifications) once a host scheduler is chosen.
 *
 *   NODE_ENV=development npx tsx scripts/run-notifications.ts
 */
async function main() {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    console.error(`Refusing to run: NODE_ENV is ${env ? `"${env}"` : "unset"}, not "development" or "test".`);
    process.exitCode = 1;
    return;
  }
  const result = await runNotificationScheduler();
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
