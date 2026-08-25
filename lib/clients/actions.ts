"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { createClientRecord, readClientFields } from "@/lib/clients/clientFields";
import { diffFields } from "@/lib/utils";
import type { ActionResult } from "@/lib/matters/actions";

/**
 * Server Actions backing Client create/edit. Every action independently
 * re-checks authentication and the Client/Matter management role rule (see
 * lib/auth/authorization.ts#canManageClientsAndMatters) rather than trusting
 * that the page already checked — Server Actions can be invoked directly
 * (see CLAUDE.md, section 4.4 and docs/SECURITY.md).
 *
 * Failure responses are intentionally generic so a denied write can't be
 * used to probe for the existence of a client.
 */

export type FormActionState = { error: string | null };
const NOT_FOUND_ERROR = "Not found or access denied.";

export async function createClient(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { error: NOT_FOUND_ERROR };
  }

  const parsed = readClientFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const client = await createClientRecord(parsed.data, user.id);

  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { error: NOT_FOUND_ERROR };
  }

  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) {
    return { error: NOT_FOUND_ERROR };
  }

  const parsed = readClientFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { dateOfBirth, ...rest } = parsed.data;

  const before = await prisma.client.findUnique({ where: { id: clientId } });
  if (!before) {
    return { error: NOT_FOUND_ERROR };
  }

  const nextDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  await prisma.client.update({
    where: { id: clientId },
    data: { ...rest, dateOfBirth: nextDateOfBirth },
  });

  // `notes` is free text (up to 5,000 chars) — record only that it changed,
  // never the content, so the audit log can't become a second copy of
  // potentially sensitive case notes (see docs/SECURITY.md).
  const { notes: nextNotes, ...restForDiff } = rest;
  const changed = diffFields(
    {
      firstName: before.firstName,
      lastName: before.lastName,
      dateOfBirth: before.dateOfBirth,
      email: before.email,
      phone: before.phone,
      address: before.address,
    },
    { ...restForDiff, dateOfBirth: nextDateOfBirth },
  );
  const notesChanged = before.notes !== (nextNotes ?? null);

  if (Object.keys(changed).length > 0 || notesChanged) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Client",
        entityId: clientId,
        metadata: { changed, ...(notesChanged ? { notesChanged: true } : {}) },
      },
    });
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

// --- Archive / reactivate ---------------------------------------------------
//
// Reversible removal from the default active Clients roster (see
// Client.archived in prisma/schema.prisma) — a pure visibility flag, never
// a delete: every Matter/Note/Task/etc. already tied to this Client stays
// completely untouched either way. Gated by the exact same role rule
// createClient/updateClient above already use — no new permission is
// invented (see lib/auth/authorization.ts#canManageClientsAndMatters and
// docs/SECURITY.md).
//
// Archiving is additionally blocked while the Client still has any
// OPEN/PENDING Matter — the safest reversible behavior for "a client still
// has active matters" (see docs/ROADMAP.md): rather than silently
// orphaning or hiding an active case, or inventing a cascading archive of
// its Matters (which this schema's Matter.archived is deliberately
// independent from), the archival is simply refused with a clear message
// naming how many active matters are in the way. A Client with only
// CLOSED matters (or none at all) can always be archived.

const archiveClientSchema = z.object({ clientId: z.string().min(1, "Required.") });

export async function archiveClient(input: { clientId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const parsed = archiveClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { clientId } = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archived: true } });
  if (!client) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  if (client.archived) {
    return { ok: false, error: "This client is already archived." };
  }

  const activeMatters = await prisma.matter.count({
    where: { clientId, status: { in: ["OPEN", "PENDING"] } },
  });
  if (activeMatters > 0) {
    return {
      ok: false,
      error: `Cannot archive: this client has ${activeMatters} active (open or pending) matter${
        activeMatters === 1 ? "" : "s"
      }. Close or reassign them first.`,
    };
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { archived: true, archivedAt: new Date(), archivedById: user.id },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Client",
      entityId: clientId,
      metadata: { archived: true },
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, data: undefined };
}

export async function reactivateClient(input: { clientId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const parsed = archiveClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { clientId } = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archived: true } });
  if (!client) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  if (!client.archived) {
    return { ok: false, error: "This client is not archived." };
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { archived: false, archivedAt: null, archivedById: null },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Client",
      entityId: clientId,
      metadata: { archived: false },
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, data: undefined };
}
