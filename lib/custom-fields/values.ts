import { Prisma } from "@prisma/client";
import type { CustomFieldEntity, CustomFieldType } from "@prisma/client";

/**
 * Pure custom-field logic: option parsing, typed value parsing/validation,
 * column mapping, display formatting, and list filters. No I/O, so every
 * rule is unit-testable (tests/custom-fields/values.test.ts).
 *
 * Values are stored in typed columns (CustomFieldValue.valueText /
 * valueNumber / valueBoolean / valueDate / valueOptionId) so editing a
 * definition can never reinterpret an existing value: a definition's type
 * is immutable once values exist, and select options are retired
 * (`archived: true`), never deleted, so stored option ids keep resolving.
 */

export type CustomFieldOption = { id: string; label: string; archived: boolean };

export type CustomFieldDef = {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  helpText: string | null;
  type: CustomFieldType;
  options: unknown;
  archivedAt: Date | null;
};

export type StoredValue = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | number | string | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueOptionId: string | null;
};

export type TypedColumns = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueOptionId: string | null;
};

export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 5_000;
export const NUMBER_ABS_MAX = 1e14;

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  SHORT_TEXT: "Short text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  BOOLEAN: "Yes / no",
  DATE: "Date",
  SINGLE_SELECT: "Single select",
};

export const CUSTOM_FIELD_TYPE_VALUES = Object.keys(CUSTOM_FIELD_TYPE_LABELS) as [CustomFieldType, ...CustomFieldType[]];

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  MATTER: "Matters",
  CONTACT: "Contacts & organizations",
  CLIENT: "Clients",
};

export const CUSTOM_FIELD_ENTITY_VALUES = Object.keys(CUSTOM_FIELD_ENTITY_LABELS) as [CustomFieldEntity, ...CustomFieldEntity[]];

export function parseOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFieldOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { id?: unknown; label?: unknown; archived?: unknown };
    if (typeof o.id === "string" && typeof o.label === "string") {
      out.push({ id: o.id, label: o.label, archived: o.archived === true });
    }
  }
  return out;
}

/** Stable key suggestion from a label: lowercase snake_case, ≤ 40 chars. */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`.slice(0, 40);
}

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export type ParsedValue =
  | { ok: true; clear: true }
  | { ok: true; clear: false; columns: TypedColumns }
  | { ok: false; error: string };

const EMPTY: TypedColumns = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueOptionId: null };

/**
 * Parse one submitted form value against its definition. An empty value
 * clears the field. `existingOptionId` lets an already-stored option that
 * has since been retired be re-submitted unchanged; a *new* selection must
 * be an active option.
 */
export function parseFieldInput(
  def: Pick<CustomFieldDef, "type" | "label" | "options">,
  raw: string | null | undefined,
  existingOptionId?: string | null,
): ParsedValue {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, clear: true };

  switch (def.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT": {
      const max = def.type === "SHORT_TEXT" ? SHORT_TEXT_MAX : LONG_TEXT_MAX;
      if (def.type === "SHORT_TEXT" && /[\r\n]/.test(value)) return { ok: false, error: `${def.label} must be a single line.` };
      if (value.length > max) return { ok: false, error: `${def.label} is too long (max ${max} characters).` };
      return { ok: true, clear: false, columns: { ...EMPTY, valueText: value } };
    }
    case "NUMBER": {
      if (!/^-?\d+(\.\d{1,4})?$/.test(value)) {
        return { ok: false, error: `${def.label} must be a number with at most 4 decimal places.` };
      }
      const n = Number(value);
      if (!Number.isFinite(n) || Math.abs(n) >= NUMBER_ABS_MAX) return { ok: false, error: `${def.label} is out of range.` };
      return { ok: true, clear: false, columns: { ...EMPTY, valueNumber: new Prisma.Decimal(value) } };
    }
    case "BOOLEAN": {
      if (value !== "true" && value !== "false") return { ok: false, error: `${def.label} must be yes or no.` };
      return { ok: true, clear: false, columns: { ...EMPTY, valueBoolean: value === "true" } };
    }
    case "DATE": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!m) return { ok: false, error: `${def.label} must be a date (YYYY-MM-DD).` };
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const date = new Date(Date.UTC(y, mo - 1, d));
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
        return { ok: false, error: `${def.label} is not a valid date.` };
      }
      return { ok: true, clear: false, columns: { ...EMPTY, valueDate: date } };
    }
    case "SINGLE_SELECT": {
      const option = parseOptions(def.options).find((o) => o.id === value);
      if (!option) return { ok: false, error: `Choose a valid option for ${def.label}.` };
      if (option.archived && option.id !== existingOptionId) {
        return { ok: false, error: `That option for ${def.label} has been retired.` };
      }
      return { ok: true, clear: false, columns: { ...EMPTY, valueOptionId: option.id } };
    }
  }
}

function normalize(v: StoredValue | TypedColumns | null): string {
  if (!v) return "null";
  return JSON.stringify([
    v.valueText,
    v.valueNumber === null ? null : new Prisma.Decimal(v.valueNumber).toString(),
    v.valueBoolean,
    v.valueDate ? v.valueDate.toISOString() : null,
    v.valueOptionId,
  ]);
}

/** Whether a stored value equals parsed columns (skip no-op writes and audit). */
export function sameColumns(a: StoredValue | null, b: TypedColumns | null): boolean {
  return normalize(a) === normalize(b);
}

/** Human-readable value. Retired options still display (marked retired). */
export function formatValue(def: Pick<CustomFieldDef, "type" | "options">, v: StoredValue | null): string {
  if (!v) return "";
  switch (def.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return v.valueText ?? "";
    case "NUMBER":
      return v.valueNumber === null ? "" : new Prisma.Decimal(v.valueNumber).toString();
    case "BOOLEAN":
      return v.valueBoolean === null ? "" : v.valueBoolean ? "Yes" : "No";
    case "DATE":
      return v.valueDate ? v.valueDate.toISOString().slice(0, 10) : "";
    case "SINGLE_SELECT": {
      if (!v.valueOptionId) return "";
      const option = parseOptions(def.options).find((o) => o.id === v.valueOptionId);
      if (!option) return "(unknown option)";
      return option.archived ? `${option.label} (retired)` : option.label;
    }
  }
}

/** The raw string a form input is pre-filled with. */
export function inputValue(def: Pick<CustomFieldDef, "type">, v: StoredValue | null): string {
  if (!v) return "";
  switch (def.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return v.valueText ?? "";
    case "NUMBER":
      return v.valueNumber === null ? "" : new Prisma.Decimal(v.valueNumber).toString();
    case "BOOLEAN":
      return v.valueBoolean === null ? "" : String(v.valueBoolean);
    case "DATE":
      return v.valueDate ? v.valueDate.toISOString().slice(0, 10) : "";
    case "SINGLE_SELECT":
      return v.valueOptionId ?? "";
  }
}

export function isFilterableType(type: CustomFieldType): boolean {
  return type === "SINGLE_SELECT" || type === "BOOLEAN" || type === "SHORT_TEXT";
}

/**
 * Matter-list filter on one MATTER custom field: equality on select /
 * boolean / short-text fields only. Anything unsupported or malformed
 * returns `null` ("no filter") — never a widened query. Callers AND this
 * with their access scope.
 */
export function buildMatterCustomFieldFilter(
  def: Pick<CustomFieldDef, "id" | "entity" | "type" | "options">,
  raw: string,
): Prisma.MatterWhereInput | null {
  if (def.entity !== "MATTER") return null;
  const value = raw.trim();
  if (!value) return null;
  let match: Prisma.CustomFieldValueWhereInput;
  if (def.type === "SINGLE_SELECT") {
    if (!parseOptions(def.options).some((o) => o.id === value)) return null;
    match = { valueOptionId: value };
  } else if (def.type === "BOOLEAN") {
    if (value !== "true" && value !== "false") return null;
    match = { valueBoolean: value === "true" };
  } else if (def.type === "SHORT_TEXT") {
    if (value.length > SHORT_TEXT_MAX) return null;
    match = { valueText: { equals: value, mode: "insensitive" } };
  } else {
    return null;
  }
  return { customFieldValues: { some: { definitionId: def.id, ...match } } };
}

/**
 * Validates an options edit against the stored options: every existing
 * option id must still be present (retire, don't delete) and labels must
 * be non-empty and unique among active options.
 */
export function validateOptionsChange(previous: CustomFieldOption[], next: CustomFieldOption[]): string | null {
  const nextIds = new Set(next.map((o) => o.id));
  if (previous.some((o) => !nextIds.has(o.id))) return "Options can be retired but not deleted.";
  if (next.some((o) => !o.label.trim() || o.label.length > 100)) return "Every option needs a label (max 100 characters).";
  const active = next.filter((o) => !o.archived).map((o) => o.label.trim().toLowerCase());
  if (new Set(active).size !== active.length) return "Active option labels must be unique.";
  if (nextIds.size !== next.length) return "Duplicate option ids.";
  return null;
}
