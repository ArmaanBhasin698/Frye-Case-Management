import type { CustomFieldEntity } from "@prisma/client";

import { prisma } from "@/lib/db";
import { formatValue, inputValue, type CustomFieldDef, type StoredValue } from "@/lib/custom-fields/values";

/**
 * Custom-field reads. These do NOT authorize the owning record: every
 * caller must already have established access to the matter / contact /
 * client (the pages that render them do, via their own layout/page
 * checks).
 */

const OWNER_COLUMN = { MATTER: "matterId", CONTACT: "contactId", CLIENT: "clientId" } as const;

export function listCustomFieldDefinitions(entity?: CustomFieldEntity, options: { includeArchived?: boolean } = {}) {
  return prisma.customFieldDefinition.findMany({
    where: { ...(entity ? { entity } : {}), ...(options.includeArchived ? {} : { archivedAt: null }) },
    include: { _count: { select: { values: true } } },
    orderBy: [{ entity: "asc" }, { position: "asc" }, { label: "asc" }],
  });
}

export type CustomFieldRow = {
  definition: CustomFieldDef & { position: number };
  value: StoredValue | null;
  display: string;
  input: string;
};

/**
 * Definitions for an entity plus this record's values. Active definitions
 * always appear (editable); archived definitions appear only when the
 * record still holds a value for them (read-only), so historic values are
 * never hidden.
 */
export async function getCustomFieldRows(entity: CustomFieldEntity, ownerId: string): Promise<{ active: CustomFieldRow[]; archived: CustomFieldRow[] }> {
  const [definitions, values] = await Promise.all([
    prisma.customFieldDefinition.findMany({ where: { entity }, orderBy: [{ position: "asc" }, { label: "asc" }] }),
    prisma.customFieldValue.findMany({ where: { [OWNER_COLUMN[entity]]: ownerId } }),
  ]);
  const byDef = new Map(values.map((v) => [v.definitionId, v]));
  const rows = definitions.map((definition) => {
    const value = byDef.get(definition.id) ?? null;
    return { definition, value, display: formatValue(definition, value), input: inputValue(definition, value) };
  });
  return {
    active: rows.filter((r) => !r.definition.archivedAt),
    archived: rows.filter((r) => r.definition.archivedAt && r.value),
  };
}

/**
 * Merge values for document templates: `{ "custom.matter.<key>": "…" }`
 * (and `custom.contact.*`, `custom.client.*`). Archived definitions with a
 * stored value are included so historic letters still merge. Callers must
 * already be authorized for every id they pass.
 */
export async function getCustomFieldMergeValues(ids: { matterId?: string; contactId?: string; clientId?: string }): Promise<Record<string, string>> {
  const owners: { entity: CustomFieldEntity; id: string }[] = [];
  if (ids.matterId) owners.push({ entity: "MATTER", id: ids.matterId });
  if (ids.contactId) owners.push({ entity: "CONTACT", id: ids.contactId });
  if (ids.clientId) owners.push({ entity: "CLIENT", id: ids.clientId });

  const out: Record<string, string> = {};
  for (const owner of owners) {
    const values = await prisma.customFieldValue.findMany({
      where: { [OWNER_COLUMN[owner.entity]]: owner.id, definition: { entity: owner.entity } },
      include: { definition: true },
    });
    for (const v of values) {
      out[`custom.${owner.entity.toLowerCase()}.${v.definition.key}`] = formatValue(v.definition, v);
    }
  }
  return out;
}

/** Every merge-field name currently available (for template authoring pickers). */
export async function listCustomMergeFieldNames(): Promise<{ name: string; label: string; entity: CustomFieldEntity }[]> {
  const defs = await prisma.customFieldDefinition.findMany({ where: { archivedAt: null }, orderBy: [{ entity: "asc" }, { position: "asc" }] });
  return defs.map((d) => ({ name: `custom.${d.entity.toLowerCase()}.${d.key}`, label: d.label, entity: d.entity }));
}
