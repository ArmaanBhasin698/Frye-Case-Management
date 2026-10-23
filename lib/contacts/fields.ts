import { z } from "zod";
import type { ContactCategory, ContactKind, PreferredContactMethod } from "@prisma/client";

import {
  CONTACT_CATEGORY_VALUES,
  PREFERRED_CONTACT_METHOD_VALUES,
} from "@/lib/contacts/labels";

/**
 * Contact form validation. A plain module (not `"use server"`) so the
 * schema and helpers are unit-testable and never directly network-callable
 * (same reasoning as lib/clients/clientFields.ts).
 */

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .optional()
    .transform((v) => (v ? v : undefined));

const emailSchema = z.string().trim().email();

const phoneEntrySchema = z.object({
  label: optionalText(40, "Phone label"),
  number: z
    .string()
    .trim()
    .min(1)
    .max(40, "Phone number is too long.")
    .refine((v) => /\d/.test(v), "Phone numbers must contain digits."),
});

const emailEntrySchema = z.object({
  label: optionalText(40, "Email label"),
  address: z.string().trim().max(200, "Email is too long.").refine((v) => emailSchema.safeParse(v).success, "Invalid email address."),
});

export const contactFieldsSchema = z
  .object({
    kind: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
    firstName: optionalText(100, "First name"),
    lastName: optionalText(100, "Last name"),
    organizationName: optionalText(200, "Organization name"),
    organizationId: optionalText(100, "Organization"),
    jobTitle: optionalText(150, "Job title"),
    categories: z.array(z.enum(CONTACT_CATEGORY_VALUES)).max(CONTACT_CATEGORY_VALUES.length),
    phones: z.array(phoneEntrySchema).max(10, "At most 10 phone numbers."),
    emails: z.array(emailEntrySchema).max(10, "At most 10 email addresses."),
    addressLine1: optionalText(200, "Address"),
    addressLine2: optionalText(200, "Address"),
    city: optionalText(100, "City"),
    state: optionalText(50, "State"),
    postalCode: optionalText(20, "Postal code"),
    preferredContactMethod: z
      .enum(PREFERRED_CONTACT_METHOD_VALUES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    notes: optionalText(5_000, "Notes"),
    court: optionalText(200, "Court"),
    jurisdiction: optionalText(200, "Jurisdiction"),
    position: optionalText(150, "Position"),
    assignedStaffId: optionalText(100, "Assigned staff"),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "INDIVIDUAL" && (!data.firstName || !data.lastName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "First and last name are required.", path: ["firstName"] });
    }
    if (data.kind === "ORGANIZATION" && !data.organizationName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Organization name is required.", path: ["organizationName"] });
    }
  });

export type ContactFields = z.infer<typeof contactFieldsSchema>;

/**
 * Phone/email rows arrive as parallel repeated fields (`phoneNumber`,
 * `phoneLabel`, ...). Blank rows are dropped rather than rejected — the
 * form always renders one empty row.
 */
function readPairs(formData: FormData, valueKey: string, labelKey: string) {
  const values = formData.getAll(valueKey).map(String);
  const labels = formData.getAll(labelKey).map(String);
  return values
    .map((value, i) => ({ value: value.trim(), label: labels[i] ?? "" }))
    .filter((row) => row.value.length > 0);
}

export function readContactFields(formData: FormData) {
  const get = (key: string) => {
    const value = formData.get(key);
    return value === null ? undefined : String(value);
  };
  return contactFieldsSchema.safeParse({
    kind: get("kind") ?? "INDIVIDUAL",
    firstName: get("firstName"),
    lastName: get("lastName"),
    organizationName: get("organizationName"),
    organizationId: get("organizationId"),
    jobTitle: get("jobTitle"),
    categories: [...new Set(formData.getAll("categories").map(String))],
    phones: readPairs(formData, "phoneNumber", "phoneLabel").map((r) => ({ number: r.value, label: r.label })),
    emails: readPairs(formData, "emailAddress", "emailLabel").map((r) => ({ address: r.value, label: r.label })),
    addressLine1: get("addressLine1"),
    addressLine2: get("addressLine2"),
    city: get("city"),
    state: get("state"),
    postalCode: get("postalCode"),
    preferredContactMethod: get("preferredContactMethod") ?? "",
    notes: get("notes"),
    court: get("court"),
    jurisdiction: get("jurisdiction"),
    position: get("position"),
    assignedStaffId: get("assignedStaffId"),
  });
}

export function deriveDisplayName(fields: {
  kind: "INDIVIDUAL" | "ORGANIZATION";
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
}): string {
  if (fields.kind === "ORGANIZATION") return (fields.organizationName ?? "").trim();
  return [fields.firstName, fields.lastName].filter(Boolean).join(" ").trim();
}

/**
 * The Contact columns a parsed form maps to. Phones/emails are written
 * separately (child rows); the first row of each becomes the primary.
 * Individuals don't carry an organization *name* (they link to an
 * organization contact instead), and organizations don't carry
 * first/last names or an organization link.
 */
export function contactColumnsFrom(fields: ContactFields) {
  const isOrg = fields.kind === "ORGANIZATION";
  return {
    kind: fields.kind,
    firstName: isOrg ? null : (fields.firstName ?? null),
    lastName: isOrg ? null : (fields.lastName ?? null),
    displayName: deriveDisplayName(fields),
    organizationId: isOrg ? null : (fields.organizationId ?? null),
    jobTitle: fields.jobTitle ?? null,
    categories: fields.categories,
    addressLine1: fields.addressLine1 ?? null,
    addressLine2: fields.addressLine2 ?? null,
    city: fields.city ?? null,
    state: fields.state ?? null,
    postalCode: fields.postalCode ?? null,
    preferredContactMethod: fields.preferredContactMethod ?? null,
    notes: fields.notes ?? null,
    court: fields.court ?? null,
    jurisdiction: fields.jurisdiction ?? null,
    position: fields.position ?? null,
    assignedStaffId: fields.assignedStaffId ?? null,
  };
}

export function phoneRowsFrom(fields: ContactFields) {
  return fields.phones.map((p, i) => ({ number: p.number, label: p.label ?? null, isPrimary: i === 0 }));
}

export function emailRowsFrom(fields: ContactFields) {
  return fields.emails.map((e, i) => ({ address: e.address.toLowerCase(), label: e.label ?? null, isPrimary: i === 0 }));
}

/** Initial values for components/shared/contact-form.tsx (create and edit). */
export type ContactFormInitial = {
  id?: string;
  kind: ContactKind;
  firstName: string;
  lastName: string;
  organizationName: string;
  organizationId: string;
  jobTitle: string;
  categories: ContactCategory[];
  phones: { label: string; number: string }[];
  emails: { label: string; address: string }[];
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  preferredContactMethod: PreferredContactMethod | "";
  notes: string;
  court: string;
  jurisdiction: string;
  position: string;
  assignedStaffId: string;
};

export const EMPTY_CONTACT: ContactFormInitial = {
  kind: "INDIVIDUAL",
  firstName: "",
  lastName: "",
  organizationName: "",
  organizationId: "",
  jobTitle: "",
  categories: [],
  phones: [],
  emails: [],
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  preferredContactMethod: "",
  notes: "",
  court: "",
  jurisdiction: "",
  position: "",
  assignedStaffId: "",
};
