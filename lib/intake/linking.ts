import { ExternalLeadProvider, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Durable external-contact ↔ Client linking, backed by `ExternalLeadLink`
 * (see prisma/schema.prisma). This is the piece that makes repeated intake
 * webhook deliveries safe: a caller looks up
 * `findClientIdByExternalContact` *before* creating a new Client, and only
 * creates one (through the existing, authenticated `createClient` —
 * unchanged, not called from here) when no link exists yet. `@@unique
 * ([provider, externalId])` is the actual authority that prevents two
 * links for the same external contact — this module's own pre-check is a
 * fast path, not the safety mechanism itself (see `linkExternalContactToClient`
 * below for what happens when that fast path loses a race).
 */

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

/**
 * Idempotent lookup: does a link already exist for this external contact?
 * Callers use this before deciding whether a new Client needs creating —
 * a `null` result means "no Client has been linked to this external
 * contact yet," not "this external contact doesn't exist at the provider."
 */
export async function findClientIdByExternalContact(
  provider: ExternalLeadProvider,
  externalId: string,
): Promise<string | null> {
  const link = await prisma.externalLeadLink.findUnique({
    where: { provider_externalId: { provider, externalId } },
    select: { clientId: true },
  });
  return link?.clientId ?? null;
}

export type LinkExternalContactResult =
  | { outcome: "linked"; linkId: string }
  | { outcome: "already_linked_to_same_client" }
  | { outcome: "conflict_linked_to_different_client"; existingClientId: string }
  | { outcome: "client_not_found" };

/**
 * Links one external contact to one Client, or explains why it didn't.
 * Checks first (fast path, avoids an unnecessary insert attempt on the
 * far more common "not linked yet" case), but the database's
 * `@@unique([provider, externalId])` constraint — not this check — is
 * the final authority: if a concurrent call wins the race between this
 * function's read and its write, the resulting unique-constraint error is
 * caught and resolved by re-reading, exactly the same way a duplicate
 * caught up-front would be. Never silently reassigns an external contact
 * already linked to a *different* Client — that's surfaced as
 * `conflict_linked_to_different_client` for the caller to investigate,
 * never overwritten.
 */
export async function linkExternalContactToClient(input: {
  provider: ExternalLeadProvider;
  externalId: string;
  clientId: string;
  /** Actor performing the link, or `null` for an unattended/system-triggered call (no user session — see lib/intake/README.md). */
  actorId: string | null;
}): Promise<LinkExternalContactResult> {
  const { provider, externalId, clientId, actorId } = input;

  const existing = await prisma.externalLeadLink.findUnique({
    where: { provider_externalId: { provider, externalId } },
  });
  if (existing) {
    return existing.clientId === clientId
      ? { outcome: "already_linked_to_same_client" }
      : { outcome: "conflict_linked_to_different_client", existingClientId: existing.clientId };
  }

  let link;
  try {
    link = await prisma.externalLeadLink.create({ data: { provider, externalId, clientId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Lost a race: another call created the link between our read above
      // and this write. Re-read rather than assume — it may have landed
      // for this same clientId (a concurrent retry of the same delivery)
      // or a different one (a genuine conflict).
      const raced = await prisma.externalLeadLink.findUnique({
        where: { provider_externalId: { provider, externalId } },
      });
      return raced?.clientId === clientId
        ? { outcome: "already_linked_to_same_client" }
        : { outcome: "conflict_linked_to_different_client", existingClientId: raced?.clientId ?? "" };
    }
    if (isForeignKeyConstraintError(error)) {
      return { outcome: "client_not_found" };
    }
    throw error;
  }

  // Never the external provider's raw contact id in audit metadata — see
  // docs/SECURITY.md's audit-metadata restraint pattern; the provider
  // name and which Client/link were involved is already fully
  // reconstructible from entityId/matterId-style fields without it.
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "CREATE",
      entityType: "ExternalLeadLink",
      entityId: link.id,
      metadata: { provider },
    },
  });

  return { outcome: "linked", linkId: link.id };
}
