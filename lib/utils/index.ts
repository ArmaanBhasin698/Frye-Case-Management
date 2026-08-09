import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type JsonPrimitive = string | number | boolean | null;

function toJsonPrimitive(value: unknown): JsonPrimitive {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value as JsonPrimitive;
}

/**
 * Shallow before/after diff over the keys present in `after`, for
 * `AuditEvent.metadata` on UPDATE actions — only changed fields are
 * included, so a no-op edit produces an empty object rather than
 * duplicating the whole record into the audit log (see docs/SECURITY.md's
 * audit logging guidance). Values are normalized to JSON-safe primitives
 * (Dates -> ISO strings) since `metadata` is a Prisma `Json` column.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { before: JsonPrimitive; after: JsonPrimitive }> {
  const changed: Record<string, { before: JsonPrimitive; after: JsonPrimitive }> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const beforeValue = toJsonPrimitive(before[key]);
    const afterValue = toJsonPrimitive(after[key]);
    if (beforeValue !== afterValue) {
      changed[key as string] = { before: beforeValue, after: afterValue };
    }
  }
  return changed;
}
