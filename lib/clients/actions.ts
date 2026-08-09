"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { diffFields } from "@/lib/utils";

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

const emailSchema = z.string().trim().email("Invalid email address.");

const clientFieldsSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100, "First name is too long."),
  lastName: z.string().trim().min(1, "Last name is required.").max(100, "Last name is too long."),
  dateOfBirth: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid date of birth."),
  email: z
    .string()
    .trim()
    .max(200, "Email is too long.")
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || emailSchema.safeParse(v).success, "Invalid email address."),
  phone: z
    .string()
    .trim()
    .max(30, "Phone number is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  address: z
    .string()
    .trim()
    .max(300, "Address is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  notes: z
    .string()
    .trim()
    .max(5_000, "Notes are too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

function readClientFields(formData: FormData) {
  return clientFieldsSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    dateOfBirth: formData.get("dateOfBirth") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    address: formData.get("address") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
}

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
  const { dateOfBirth, ...rest } = parsed.data;

  const client = await prisma.client.create({
    data: { ...rest, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Client",
      entityId: client.id,
      metadata: { firstName: client.firstName, lastName: client.lastName },
    },
  });

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
