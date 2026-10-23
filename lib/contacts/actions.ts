"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters, type AuthorizableUser } from "@/lib/auth/authorization";
import { diffFields } from "@/lib/utils";
import type { ActionResult } from "@/lib/matters/actions";
import { canViewContact, contactVisibilityFilterFor } from "@/lib/contacts/visibility";
import { findDuplicateContacts, type DuplicateMatch } from "@/lib/contacts/duplicates";
import {
  contactColumnsFrom,
  emailRowsFrom,
  phoneRowsFrom,
  readContactFields,
  type ContactFields,
} from "@/lib/contacts/fields";
import {
  CONTACT_CATEGORY_VALUES,
  FOLLOW_UP_STATUS_VALUES,
  INTERACTION_TYPE_VALUES,
  RELATIONSHIP_TYPE_VALUES,
} from "@/lib/contacts/labels";

/**
 * Server Actions for the Contacts module. Each one re-checks the session,
 * contact visibility (lib/contacts/visibility.ts), and — for anything tied
 * to a matter — `hasMatterAccess`, independently of the page that rendered
 * the form (CLAUDE.md section 4.4). Denials share one generic message so a
 * forged id can't distinguish "doesn't exist" from "not yours."
 *
 * Audit metadata carries ids, enum values, and changed field names only —
 * never notes, interaction summaries, or relationship context text.
 */

const NOT_FOUND_ERROR = "Not found or access denied.";
const cuid = z.string().trim().min(1, "Required.").max(100);

export type ContactFormState = { error: string | null; duplicates?: DuplicateMatch[] };
export type FormActionState = { error: string | null };

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid date.");

function formValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return value === null ? undefined : String(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * The organization link and assigned staff member are ids from the form;
 * both are re-validated here so a forged id can't attach a contact to an
 * organization the user can't see, or "assign" it to an inactive account.
 */
async function validateReferences(user: AuthorizableUser, fields: ContactFields, selfId?: string): Promise<string | null> {
  if (fields.kind === "INDIVIDUAL" && fields.organizationId) {
    if (fields.organizationId === selfId) return "A contact can't be its own organization.";
    const visibility = await contactVisibilityFilterFor(user);
    const org = await prisma.contact.count({
      where: { AND: [{ id: fields.organizationId, kind: "ORGANIZATION" }, visibility] },
    });
    if (org === 0) return "Choose a valid organization.";
  }
  if (fields.assignedStaffId) {
    const staff = await prisma.user.count({ where: { id: fields.assignedStaffId, status: "ACTIVE" } });
    if (staff === 0) return "Choose an active staff member.";
  }
  return null;
}

// --- Create / update ----------------------------------------------------------

const linkSchema = z.object({
  matterId: cuid.optional(),
  role: z.enum(CONTACT_CATEGORY_VALUES).optional(),
});

export async function createContact(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireCurrentUser();

  const parsed = readContactFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;

  const link = linkSchema.safeParse({
    matterId: formValue(formData, "linkMatterId") || undefined,
    role: formValue(formData, "linkRole") || undefined,
  });
  if (!link.success) return { error: "Choose a valid role for this matter." };
  const { matterId: linkMatterId, role: linkRole } = link.data;
  if (linkMatterId && !linkRole) return { error: "Choose this contact's role on the matter." };
  if (linkMatterId && !(await hasMatterAccess(user, linkMatterId))) return { error: NOT_FOUND_ERROR };

  const referenceError = await validateReferences(user, fields);
  if (referenceError) return { error: referenceError };

  if (formValue(formData, "confirmDuplicate") !== "1") {
    const columns = contactColumnsFrom(fields);
    const duplicates = await findDuplicateContacts(
      {
        displayName: columns.displayName,
        emails: fields.emails.map((e) => e.address),
        phones: fields.phones.map((p) => p.number),
      },
      await contactVisibilityFilterFor(user),
    );
    if (duplicates.length > 0) return { error: null, duplicates };
  }

  let contactId: string;
  try {
    contactId = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          ...contactColumnsFrom(fields),
          createdById: user.id,
          phones: { create: phoneRowsFrom(fields) },
          emails: { create: emailRowsFrom(fields) },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "Contact",
          entityId: contact.id,
          metadata: { kind: contact.kind, categories: contact.categories },
        },
      });
      if (linkMatterId && linkRole) {
        const matterLink = await tx.matterContact.create({
          data: { matterId: linkMatterId, contactId: contact.id, role: linkRole, addedById: user.id },
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            action: "CREATE",
            entityType: "MatterContact",
            entityId: matterLink.id,
            matterId: linkMatterId,
            metadata: { contactId: contact.id, role: linkRole },
          },
        });
      }
      return contact.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { error: NOT_FOUND_ERROR };
    }
    throw error;
  }

  revalidatePath("/contacts");
  if (linkMatterId) revalidatePath(`/matters/${linkMatterId}/contacts`);
  redirect(linkMatterId ? `/matters/${linkMatterId}/contacts` : `/contacts/${contactId}`);
}

export async function updateContact(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const user = await requireCurrentUser();

  const contactId = cuid.safeParse(formValue(formData, "contactId"));
  if (!contactId.success || !(await canViewContact(user, contactId.data))) return { error: NOT_FOUND_ERROR };

  const before = await prisma.contact.findUnique({ where: { id: contactId.data } });
  if (!before) return { error: NOT_FOUND_ERROR };

  // A client's directory entry takes its names from the Client record
  // (kept in sync by lib/clients/actions.ts#updateClient), so the form's
  // name fields are ignored here rather than allowed to drift.
  if (before.clientId) {
    formData.set("kind", "INDIVIDUAL");
    formData.set("firstName", before.firstName ?? "");
    formData.set("lastName", before.lastName ?? "");
  }

  const parsed = readContactFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;

  const referenceError = await validateReferences(user, fields, before.id);
  if (referenceError) return { error: referenceError };
  if (before.kind === "ORGANIZATION" && fields.kind === "INDIVIDUAL") {
    const members = await prisma.contact.count({ where: { organizationId: before.id } });
    if (members > 0) return { error: "People are still linked to this organization — move them first." };
  }

  const columns = contactColumnsFrom(fields);
  const { notes: nextNotes, categories: nextCategories, ...columnsForDiff } = columns;
  const changed = diffFields(
    {
      kind: before.kind,
      firstName: before.firstName,
      lastName: before.lastName,
      displayName: before.displayName,
      organizationId: before.organizationId,
      jobTitle: before.jobTitle,
      addressLine1: before.addressLine1,
      addressLine2: before.addressLine2,
      city: before.city,
      state: before.state,
      postalCode: before.postalCode,
      preferredContactMethod: before.preferredContactMethod,
      court: before.court,
      jurisdiction: before.jurisdiction,
      position: before.position,
      assignedStaffId: before.assignedStaffId,
    },
    columnsForDiff,
  );
  const categoriesChanged = [...before.categories].sort().join() !== [...nextCategories].sort().join();

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: before.id }, data: columns });
    await tx.contactPhone.deleteMany({ where: { contactId: before.id } });
    await tx.contactEmail.deleteMany({ where: { contactId: before.id } });
    const phones = phoneRowsFrom(fields);
    const emails = emailRowsFrom(fields);
    if (phones.length > 0) await tx.contactPhone.createMany({ data: phones.map((p) => ({ ...p, contactId: before.id })) });
    if (emails.length > 0) await tx.contactEmail.createMany({ data: emails.map((e) => ({ ...e, contactId: before.id })) });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Contact",
        entityId: before.id,
        metadata: {
          changed,
          ...(categoriesChanged ? { categories: nextCategories } : {}),
          ...(before.notes !== nextNotes ? { notesChanged: true } : {}),
          contactMethodsReplaced: true,
        },
      },
    });
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${before.id}`);
  redirect(`/contacts/${before.id}`);
}

// --- Archive / reactivate -----------------------------------------------------

const contactIdSchema = z.object({ contactId: cuid });

async function setContactArchived(input: { contactId: string }, archived: boolean): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) return { ok: false, error: NOT_FOUND_ERROR };
  const parsed = contactIdSchema.safeParse(input);
  if (!parsed.success || !(await canViewContact(user, parsed.data.contactId))) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  const { contactId } = parsed.data;

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contactId },
      data: archived
        ? { archived: true, archivedAt: new Date(), archivedById: user.id }
        : { archived: false, archivedAt: null, archivedById: null },
    }),
    prisma.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "Contact", entityId: contactId, metadata: { archived } },
    }),
  ]);

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, data: undefined };
}

export async function archiveContact(input: { contactId: string }): Promise<ActionResult> {
  return setContactArchived(input, true);
}

export async function reactivateContact(input: { contactId: string }): Promise<ActionResult> {
  return setContactArchived(input, false);
}

// --- Matter associations ------------------------------------------------------

const addToMatterSchema = z
  .object({
    matterId: cuid,
    contactId: cuid,
    role: z.enum(CONTACT_CATEGORY_VALUES),
    roleDetail: z.string().trim().max(200, "Role detail is too long.").optional().transform((v) => (v ? v : undefined)),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .refine((d) => !d.startDate || !d.endDate || new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export async function addContactToMatter(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = addToMatterSchema.safeParse({
    matterId: formValue(formData, "matterId"),
    contactId: formValue(formData, "contactId"),
    role: formValue(formData, "role"),
    roleDetail: formValue(formData, "roleDetail"),
    startDate: formValue(formData, "startDate"),
    endDate: formValue(formData, "endDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { matterId, contactId, role, roleDetail, startDate, endDate } = parsed.data;

  if (!(await hasMatterAccess(user, matterId)) || !(await canViewContact(user, contactId))) {
    return { error: NOT_FOUND_ERROR };
  }

  const existing = await prisma.matterContact.findUnique({
    where: { matterId_contactId_role: { matterId, contactId, role } },
  });
  if (existing && !existing.removedAt) return { error: "This contact is already on the matter in that role." };

  const data = {
    roleDetail: roleDetail ?? null,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
  };
  try {
    const link = existing
      ? await prisma.matterContact.update({
          where: { id: existing.id },
          data: { ...data, removedAt: null, addedById: user.id, addedAt: new Date() },
        })
      : await prisma.matterContact.create({ data: { ...data, matterId, contactId, role, addedById: user.id } });
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "MatterContact",
        entityId: link.id,
        matterId,
        metadata: { contactId, role, ...(existing ? { restored: true } : {}) },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return { error: "This contact is already on the matter in that role." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidatePath(`/matters/${matterId}/contacts`);
  revalidatePath(`/contacts/${contactId}`);
  return { error: null };
}

/**
 * Removes a contact from one matter without deleting anything: the link is
 * stamped `removedAt` (history survives, and re-adding restores it) and the
 * Contact itself is untouched.
 */
export async function removeContactFromMatter(input: { matterContactId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterContactId: cuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const link = await prisma.matterContact.findUnique({ where: { id: parsed.data.matterContactId } });
  if (!link || link.removedAt || !(await hasMatterAccess(user, link.matterId))) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  await prisma.$transaction([
    prisma.matterContact.update({ where: { id: link.id }, data: { removedAt: new Date() } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "MatterContact",
        entityId: link.id,
        matterId: link.matterId,
        metadata: { contactId: link.contactId, role: link.role, removed: true },
      },
    }),
  ]);

  revalidatePath(`/matters/${link.matterId}/contacts`);
  revalidatePath(`/contacts/${link.contactId}`);
  return { ok: true, data: undefined };
}

// --- Relationships ------------------------------------------------------------

const relationshipSchema = z
  .object({
    contactId: cuid,
    otherContactId: cuid,
    type: z.enum(RELATIONSHIP_TYPE_VALUES),
    scope: z.enum(["PERMANENT", "MATTER"]),
    matterId: cuid.optional(),
    context: z.string().trim().max(1_000, "Context is too long.").optional().transform((v) => (v ? v : undefined)),
  })
  .refine((d) => d.contactId !== d.otherContactId, { message: "A contact can't be associated with itself." })
  .refine((d) => d.scope !== "MATTER" || d.matterId, { message: "Choose the matter for a matter-specific relationship." });

/**
 * Records "<other contact> is <type> of <this contact>". Both contacts must
 * be visible to the caller, and a matter-specific relationship requires
 * access to that matter.
 */
export async function createContactRelationship(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = relationshipSchema.safeParse({
    contactId: formValue(formData, "contactId"),
    otherContactId: formValue(formData, "otherContactId"),
    type: formValue(formData, "type"),
    scope: formValue(formData, "scope") ?? "PERMANENT",
    matterId: formValue(formData, "matterId") || undefined,
    context: formValue(formData, "context"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { contactId, otherContactId, type, scope, context } = parsed.data;
  const matterId = scope === "MATTER" ? parsed.data.matterId! : null;

  if (!(await canViewContact(user, contactId)) || !(await canViewContact(user, otherContactId))) {
    return { error: NOT_FOUND_ERROR };
  }
  if (matterId && !(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND_ERROR };

  try {
    await prisma.$transaction(async (tx) => {
      const relationship = await tx.contactRelationship.create({
        data: {
          fromContactId: otherContactId,
          toContactId: contactId,
          type,
          scope,
          matterId,
          context: context ?? null,
          createdById: user.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ContactRelationship",
          entityId: relationship.id,
          matterId,
          metadata: { fromContactId: otherContactId, toContactId: contactId, type, scope },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath(`/contacts/${otherContactId}`);
  return { error: null };
}

export async function deleteContactRelationship(input: { relationshipId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ relationshipId: cuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const relationship = await prisma.contactRelationship.findUnique({ where: { id: parsed.data.relationshipId } });
  if (
    !relationship ||
    !(await canViewContact(user, relationship.fromContactId)) ||
    !(await canViewContact(user, relationship.toContactId)) ||
    (relationship.matterId && !(await hasMatterAccess(user, relationship.matterId)))
  ) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  await prisma.$transaction([
    prisma.contactRelationship.delete({ where: { id: relationship.id } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "DELETE",
        entityType: "ContactRelationship",
        entityId: relationship.id,
        matterId: relationship.matterId,
        metadata: {
          fromContactId: relationship.fromContactId,
          toContactId: relationship.toContactId,
          type: relationship.type,
          scope: relationship.scope,
        },
      },
    }),
  ]);

  revalidatePath(`/contacts/${relationship.fromContactId}`);
  revalidatePath(`/contacts/${relationship.toContactId}`);
  return { ok: true, data: undefined };
}

// --- Interactions -------------------------------------------------------------

/** Clock-skew allowance for "this already happened" — an interaction can't be recorded in the future. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const interactionSchema = z.object({
  contactId: cuid,
  matterId: cuid.optional(),
  type: z.enum(INTERACTION_TYPE_VALUES),
  occurredAt: z
    .string()
    .min(1, "When did this happen?")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date/time."),
  staffId: cuid.optional(),
  summary: z.string().trim().min(1, "A brief description is required.").max(5_000, "Description is too long."),
  outcome: z.string().trim().max(2_000, "Outcome is too long.").optional().transform((v) => (v ? v : undefined)),
  followUpStatus: z.enum(FOLLOW_UP_STATUS_VALUES).default("NONE"),
});

/**
 * Manually records something that *actually happened* with a contact. A
 * future `occurredAt` is rejected — scheduling belongs on the calendar,
 * and a scheduled meeting must never show up as a completed interaction.
 */
export async function recordContactInteraction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = interactionSchema.safeParse({
    contactId: formValue(formData, "contactId"),
    matterId: formValue(formData, "matterId") || undefined,
    type: formValue(formData, "type"),
    occurredAt: formValue(formData, "occurredAt"),
    staffId: formValue(formData, "staffId") || undefined,
    summary: formValue(formData, "summary"),
    outcome: formValue(formData, "outcome"),
    followUpStatus: formValue(formData, "followUpStatus") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { contactId, matterId, type, summary, outcome, followUpStatus } = parsed.data;
  const occurredAt = new Date(parsed.data.occurredAt);
  if (occurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return { error: "Interactions record things that already happened — schedule future events on the calendar." };
  }

  if (!(await canViewContact(user, contactId))) return { error: NOT_FOUND_ERROR };
  if (matterId && !(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND_ERROR };

  const staffId = parsed.data.staffId ?? user.id;
  if (staffId !== user.id) {
    const staff = await prisma.user.count({ where: { id: staffId, status: "ACTIVE" } });
    if (staff === 0) return { error: "Choose an active staff member." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const interaction = await tx.contactInteraction.create({
        data: {
          contactId,
          matterId: matterId ?? null,
          type,
          occurredAt,
          staffId,
          summary,
          outcome: outcome ?? null,
          followUpStatus,
          recordedById: user.id,
        },
      });
      await tx.contact.updateMany({
        where: { id: contactId, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }] },
        data: { lastContactedAt: occurredAt },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ContactInteraction",
          entityId: interaction.id,
          matterId: matterId ?? null,
          metadata: { contactId, type, followUpStatus },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  return { error: null };
}

export async function setInteractionFollowUpStatus(input: {
  interactionId: string;
  followUpStatus: string;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ interactionId: cuid, followUpStatus: z.enum(FOLLOW_UP_STATUS_VALUES) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const interaction = await prisma.contactInteraction.findUnique({ where: { id: parsed.data.interactionId } });
  if (
    !interaction ||
    !(await canViewContact(user, interaction.contactId)) ||
    (interaction.matterId && !(await hasMatterAccess(user, interaction.matterId)))
  ) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  await prisma.$transaction([
    prisma.contactInteraction.update({
      where: { id: interaction.id },
      data: { followUpStatus: parsed.data.followUpStatus },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ContactInteraction",
        entityId: interaction.id,
        matterId: interaction.matterId,
        metadata: { followUpStatus: { before: interaction.followUpStatus, after: parsed.data.followUpStatus } },
      },
    }),
  ]);

  revalidatePath(`/contacts/${interaction.contactId}`);
  return { ok: true, data: undefined };
}
