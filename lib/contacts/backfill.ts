import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Gives every existing Client without one its Contact-directory entry
 * (new clients get theirs at creation — lib/clients/clientFields.ts).
 * Idempotent: it only touches clients with no contact, and
 * `Contact.clientId @unique` turns a concurrent duplicate into a skipped
 * row rather than a second contact. Copies names only, like the create
 * path; it never invents categories, matter links, or interactions.
 */
export async function backfillClientContacts(): Promise<{ created: number; skipped: number }> {
  const clients = await prisma.client.findMany({
    where: { contact: { is: null } },
    select: { id: true, firstName: true, lastName: true },
  });

  let created = 0;
  let skipped = 0;
  for (const client of clients) {
    try {
      await prisma.contact.create({
        data: {
          kind: "INDIVIDUAL",
          firstName: client.firstName,
          lastName: client.lastName,
          displayName: `${client.firstName} ${client.lastName}`,
          clientId: client.id,
        },
      });
      created++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  return { created, skipped };
}
