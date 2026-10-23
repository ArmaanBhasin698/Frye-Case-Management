"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { CustomFieldEntity } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { canEditCustomValues } from "@/lib/custom-fields/access";
import {
  CUSTOM_FIELD_ENTITY_VALUES,
  CUSTOM_FIELD_TYPE_VALUES,
  KEY_PATTERN,
  parseFieldInput,
  parseOptions,
  sameColumns,
  slugifyKey,
  validateOptionsChange,
  type CustomFieldOption,
  type TypedColumns,
} from "@/lib/custom-fields/values";

/**
 * Custom-field Server Actions. Definitions are ADMIN-only. Values follow
 * the owning record's own edit rule: MATTER → canEditMatter, CONTACT →
 * canViewContact (same rule as updateContact), CLIENT →
 * canManageClientsAndMatters. Audit metadata records definition ids,
 * keys, types, and "changed" flags only — never a field value.
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const ADMIN_PATH = "/admin/custom-fields";

function formString(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return v === null ? undefined : String(v);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

function newOptionsFrom(text: string | undefined): CustomFieldOption[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ id: `opt_${randomUUID().slice(0, 8)}`, label, archived: false }));
}

const createSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITY_VALUES),
  label: z.string().trim().min(1, "Label is required.").max(100, "Label is too long."),
  key: optionalText(40),
  type: z.enum(CUSTOM_FIELD_TYPE_VALUES),
  helpText: optionalText(300),
  optionsText: optionalText(5_000),
});

export async function createCustomFieldDefinition(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };

  const parsed = createSchema.safeParse({
    entity: formString(formData, "entity"),
    label: formString(formData, "label"),
    key: formString(formData, "key"),
    type: formString(formData, "type"),
    helpText: formString(formData, "helpText"),
    optionsText: formString(formData, "optionsText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { entity, label, type, helpText, optionsText } = parsed.data;
  const key = parsed.data.key ?? slugifyKey(label);
  if (!KEY_PATTERN.test(key)) return { error: "Key must start with a letter and use only lowercase letters, digits, and underscores." };

  const options = type === "SINGLE_SELECT" ? newOptionsFrom(optionsText) : [];
  if (type === "SINGLE_SELECT") {
    if (options.length === 0) return { error: "A single-select field needs at least one option." };
    const optionError = validateOptionsChange([], options);
    if (optionError) return { error: optionError };
  }

  const last = await prisma.customFieldDefinition.aggregate({ where: { entity }, _max: { position: true } });
  try {
    const def = await prisma.customFieldDefinition.create({
      data: {
        entity,
        key,
        label,
        type,
        helpText: helpText ?? null,
        options: type === "SINGLE_SELECT" ? options : Prisma.JsonNull,
        position: (last._max.position ?? 0) + 1,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "CustomFieldDefinition",
        entityId: def.id,
        metadata: { entity, key, type },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A field with that key already exists for this record type." };
    }
    throw error;
  }

  revalidatePath(ADMIN_PATH);
  return { error: null };
}

const updateSchema = z.object({
  definitionId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1, "Label is required.").max(100, "Label is too long."),
  type: z.enum(CUSTOM_FIELD_TYPE_VALUES),
  helpText: optionalText(300),
  position: z.coerce.number().int().min(0).max(10_000),
  newOptionsText: optionalText(5_000),
});

/**
 * Edits a definition. The key is immutable. The type may only change while
 * no value exists for the field. Select options can be relabelled or
 * retired but never deleted, so stored values keep resolving.
 */
export async function updateCustomFieldDefinition(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };

  const parsed = updateSchema.safeParse({
    definitionId: formString(formData, "definitionId"),
    label: formString(formData, "label"),
    type: formString(formData, "type"),
    helpText: formString(formData, "helpText"),
    position: formString(formData, "position") ?? "0",
    newOptionsText: formString(formData, "newOptionsText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { definitionId, label, type, helpText, position, newOptionsText } = parsed.data;

  const before = await prisma.customFieldDefinition.findUnique({ where: { id: definitionId } });
  if (!before) return { error: NOT_FOUND };

  if (type !== before.type) {
    const valueCount = await prisma.customFieldValue.count({ where: { definitionId } });
    if (valueCount > 0) return { error: "The type can't change once values have been recorded. Create a new field instead." };
  }

  let options: CustomFieldOption[] = [];
  if (type === "SINGLE_SELECT") {
    const previous = before.type === "SINGLE_SELECT" ? parseOptions(before.options) : [];
    const ids = formData.getAll("optionId").map(String);
    const labels = formData.getAll("optionLabel").map(String);
    const archivedIds = new Set(formData.getAll("optionArchived").map(String));
    const edited = ids
      .map((id, i) => ({ id, label: (labels[i] ?? "").trim(), archived: archivedIds.has(id) }))
      .filter((o) => previous.some((p) => p.id === o.id));
    options = [...edited, ...newOptionsFrom(newOptionsText)];
    const optionError = validateOptionsChange(previous, options);
    if (optionError) return { error: optionError };
    if (!options.some((o) => !o.archived)) return { error: "A single-select field needs at least one active option." };
  }

  const nextOptions = type === "SINGLE_SELECT" ? options : null;
  const changed: string[] = [];
  if (label !== before.label) changed.push("label");
  if ((helpText ?? null) !== before.helpText) changed.push("helpText");
  if (type !== before.type) changed.push("type");
  if (position !== before.position) changed.push("position");
  if (JSON.stringify(nextOptions) !== JSON.stringify(before.type === "SINGLE_SELECT" ? parseOptions(before.options) : null)) {
    changed.push("options");
  }
  if (changed.length === 0) return { error: null };

  await prisma.$transaction([
    prisma.customFieldDefinition.update({
      where: { id: definitionId },
      data: { label, helpText: helpText ?? null, type, position, options: nextOptions ?? Prisma.JsonNull },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "CustomFieldDefinition",
        entityId: definitionId,
        metadata: { key: before.key, changed, ...(changed.includes("type") ? { type: { before: before.type, after: type } } : {}) },
      },
    }),
  ]);

  revalidatePath(ADMIN_PATH);
  return { error: null };
}

export async function setCustomFieldDefinitionArchived(input: { definitionId: string; archived: boolean }): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = z.object({ definitionId: z.string().min(1).max(100), archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };
  const def = await prisma.customFieldDefinition.findUnique({ where: { id: parsed.data.definitionId }, select: { key: true } });
  if (!def) return { error: NOT_FOUND };

  await prisma.$transaction([
    prisma.customFieldDefinition.update({
      where: { id: parsed.data.definitionId },
      data: { archivedAt: parsed.data.archived ? new Date() : null },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "CustomFieldDefinition",
        entityId: parsed.data.definitionId,
        metadata: { key: def.key, archived: parsed.data.archived },
      },
    }),
  ]);
  revalidatePath(ADMIN_PATH);
  return { error: null };
}

// --- Values -----------------------------------------------------------------------

const OWNER_COLUMN = { MATTER: "matterId", CONTACT: "contactId", CLIENT: "clientId" } as const;

function revalidateOwner(entity: CustomFieldEntity, ownerId: string) {
  if (entity === "MATTER") {
    revalidatePath(`/matters/${ownerId}`);
    revalidatePath("/matters");
  } else if (entity === "CONTACT") revalidatePath(`/contacts/${ownerId}`);
  else revalidatePath(`/clients/${ownerId}`);
}

/**
 * Saves the custom-field values submitted for one record (`cf_<definitionId>`
 * inputs). Only *active* definitions of the record's own entity are read,
 * so a forged id for another entity's (or an archived) definition is
 * simply never processed. A field absent from the form is left untouched;
 * an empty value clears it. All writes happen in one transaction.
 */
export async function saveCustomFieldValues(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ entity: z.enum(CUSTOM_FIELD_ENTITY_VALUES), ownerId: z.string().trim().min(1).max(100) })
    .safeParse({ entity: formString(formData, "entity"), ownerId: formString(formData, "ownerId") });
  if (!parsed.success) return { error: NOT_FOUND };
  const { entity, ownerId } = parsed.data;
  if (!(await canEditCustomValues(user, entity, ownerId))) return { error: NOT_FOUND };

  const ownerColumn = OWNER_COLUMN[entity];
  const [definitions, existing] = await Promise.all([
    prisma.customFieldDefinition.findMany({ where: { entity, archivedAt: null } }),
    prisma.customFieldValue.findMany({ where: { [ownerColumn]: ownerId } }),
  ]);
  const existingByDef = new Map(existing.map((v) => [v.definitionId, v]));

  const writes: { definitionId: string; columns: TypedColumns | null }[] = [];
  for (const def of definitions) {
    const raw = formData.get(`cf_${def.id}`);
    if (raw === null) continue;
    const current = existingByDef.get(def.id) ?? null;
    const result = parseFieldInput(def, String(raw), current?.valueOptionId ?? null);
    if (!result.ok) return { error: result.error };
    const next = result.clear ? null : result.columns;
    if (next === null ? current === null : sameColumns(current, next)) continue;
    writes.push({ definitionId: def.id, columns: next });
  }
  if (writes.length === 0) return { error: null };

  try {
    await prisma.$transaction(async (tx) => {
      for (const w of writes) {
        const owner = { [ownerColumn]: ownerId } as { matterId?: string; contactId?: string; clientId?: string };
        if (w.columns === null) {
          await tx.customFieldValue.deleteMany({ where: { definitionId: w.definitionId, ...owner } });
          continue;
        }
        const current = existingByDef.get(w.definitionId);
        if (current) {
          await tx.customFieldValue.update({ where: { id: current.id }, data: { ...w.columns, updatedById: user.id } });
        } else {
          await tx.customFieldValue.create({ data: { definitionId: w.definitionId, ...owner, ...w.columns, updatedById: user.id } });
        }
      }
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "CustomFieldValues",
          entityId: ownerId,
          matterId: entity === "MATTER" ? ownerId : null,
          metadata: { entity, changedDefinitionIds: writes.map((w) => w.definitionId) },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2002")) {
      return { error: NOT_FOUND };
    }
    throw error;
  }

  revalidateOwner(entity, ownerId);
  return { error: null };
}
