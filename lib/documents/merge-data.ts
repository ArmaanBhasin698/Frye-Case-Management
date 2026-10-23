import type { CustomFieldType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { CONTACT_CATEGORY_VALUES } from "@/lib/contacts/labels";
import type { MergeCatalog } from "@/lib/documents/templates";

/**
 * Resolves merge-field values for one matter. Callers must already have
 * authorized matter access — every value comes from that matter, its
 * client, its active contact links, or its/its client's custom fields, so
 * nothing from another matter can be merged in.
 */

export const FIRM_NAME = "Frye Law Group";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

type CustomValueRow = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueOptionId: string | null;
  definition: { key: string; type: CustomFieldType; options: Prisma.JsonValue };
};

/** Formats a stored custom-field value by its definition type; unknown/retired select options still resolve by id. */
export function formatCustomValue(row: CustomValueRow): string | null {
  switch (row.definition.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return row.valueText || null;
    case "NUMBER":
      return row.valueNumber === null ? null : row.valueNumber.toString();
    case "BOOLEAN":
      return row.valueBoolean === null ? null : row.valueBoolean ? "Yes" : "No";
    case "DATE":
      return row.valueDate ? formatDate(row.valueDate) : null;
    case "SINGLE_SELECT": {
      if (!row.valueOptionId) return null;
      const options = Array.isArray(row.definition.options) ? (row.definition.options as { id?: string; label?: string }[]) : [];
      return options.find((o) => o?.id === row.valueOptionId)?.label ?? null;
    }
  }
}

export async function getMergeCatalog(): Promise<MergeCatalog & { customLabels: Record<string, string> }> {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entity: { in: ["MATTER", "CLIENT"] } },
    select: { entity: true, key: true, label: true, archivedAt: true },
    orderBy: [{ entity: "asc" }, { position: "asc" }],
  });
  const customLabels: Record<string, string> = {};
  for (const d of definitions) {
    customLabels[`custom.${d.entity === "MATTER" ? "matter" : "client"}.${d.key}`] = `${d.label}${d.archivedAt ? " (archived)" : ""}`;
  }
  return {
    customMatterKeys: definitions.filter((d) => d.entity === "MATTER").map((d) => d.key),
    customClientKeys: definitions.filter((d) => d.entity === "CLIENT").map((d) => d.key),
    customLabels,
  };
}

export async function buildMergeValues(matterId: string, user: { name?: string | null }, now = new Date()) {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      caseNumber: true,
      court: true,
      charges: true,
      openedDate: true,
      clientId: true,
      client: { select: { firstName: true, lastName: true, address: true, email: true, phone: true } },
      contactLinks: {
        where: { removedAt: null },
        select: { role: true, contact: { select: { displayName: true } } },
        orderBy: { contact: { displayName: "asc" } },
      },
    },
  });
  if (!matter) return null;

  const customRows = await prisma.customFieldValue.findMany({
    where: { OR: [{ matterId }, { clientId: matter.clientId }] },
    select: {
      matterId: true,
      clientId: true,
      valueText: true,
      valueNumber: true,
      valueBoolean: true,
      valueDate: true,
      valueOptionId: true,
      definition: { select: { key: true, type: true, options: true } },
    },
  });

  const values: Record<string, string | null> = {
    "matter.caseNumber": matter.caseNumber,
    "matter.court": matter.court,
    "matter.charges": matter.charges,
    "matter.openedDate": formatDate(matter.openedDate),
    "client.fullName": `${matter.client.firstName} ${matter.client.lastName}`,
    "client.firstName": matter.client.firstName,
    "client.lastName": matter.client.lastName,
    "client.address": matter.client.address,
    "client.email": matter.client.email,
    "client.phone": matter.client.phone,
    "firm.name": FIRM_NAME,
    today: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(now),
    "user.name": user.name ?? null,
  };

  for (const role of CONTACT_CATEGORY_VALUES) {
    const names = matter.contactLinks.filter((l) => l.role === role).map((l) => l.contact.displayName);
    values[`contact.${role}.displayName`] = names.length > 0 ? [...new Set(names)].join("; ") : null;
  }

  for (const row of customRows) {
    const prefix = row.matterId ? "custom.matter." : "custom.client.";
    values[`${prefix}${row.definition.key}`] = formatCustomValue(row);
  }

  return values;
}
