import { z } from "zod";

import { prisma } from "@/lib/db";

/**
 * Client field validation/insert, shared by lib/clients/actions.ts
 * (`createClient`) and lib/intake/reviewActions.ts
 * (`createClientFromIntakeLead`) — deliberately a plain module, not part
 * of lib/clients/actions.ts's `"use server"` file: every export of a
 * `"use server"` file becomes a directly network-callable Server Action,
 * and `createClientRecord` takes a caller-supplied `actorId` — that must
 * never be reachable directly, only called from within an action that has
 * already authenticated the caller and derived `actorId` from their own
 * session.
 */

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

export function readClientFields(formData: FormData) {
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

export type ParsedClientFields = {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

/**
 * Shared insert used by `createClient` (lib/clients/actions.ts) and
 * `createClientFromIntakeLead` (lib/intake/reviewActions.ts) — pulled out
 * so a staff-initiated "create Client from a reviewed intake lead" goes
 * through the exact same write/audit path as the ordinary "New Client"
 * form, instead of a second, drifting copy of it. `actorId` must come from
 * the caller's own already-authenticated session — never from user input.
 */
export async function createClientRecord(fields: ParsedClientFields, actorId: string) {
  const { dateOfBirth, ...rest } = fields;
  const client = await prisma.client.create({
    data: { ...rest, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined },
  });

  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "CREATE",
      entityType: "Client",
      entityId: client.id,
      metadata: { firstName: client.firstName, lastName: client.lastName },
    },
  });

  return client;
}
