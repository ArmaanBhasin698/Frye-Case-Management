import type { NormalizedIntakeLead } from "@/lib/intake/types";

/**
 * Pure mapping from a normalized intake lead onto the exact field shape
 * `lib/clients/actions.ts#createClient` accepts (`firstName`, `lastName`,
 * `email`, `phone`; `dateOfBirth`/`address`/`notes` are never derivable
 * from intake and are always left `undefined` for staff to fill in).
 *
 * Deliberately does NOT call `createClient` or write anything to the
 * database itself — see lib/intake/README.md for why: `createClient`
 * requires an authenticated, role-checked session and is designed to be
 * driven by a staff member reviewing a form, not an unattended webhook.
 * The intended flow is: a future intake adapter receives the webhook,
 * normalizes it, maps it with this function, and presents it to staff
 * (e.g. a prefilled "New Client" form) for deliberate creation — CLAUDE.md
 * §1 is explicit that this system starts at the "client is retained"
 * stage, not at automatic lead ingestion.
 */
export type MappedClientFields = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
};

export function mapIntakeLeadToClientFields(lead: NormalizedIntakeLead): MappedClientFields {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
  };
}
