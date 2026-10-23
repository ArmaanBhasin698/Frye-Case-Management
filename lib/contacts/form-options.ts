import type { Contact, ContactEmail, ContactPhone } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { listContactOptions } from "@/lib/contacts/queries";
import type { ContactFormInitial } from "@/lib/contacts/fields";

/** Organization + staff options for the contact form, both already scoped (visible organizations, active staff). */
export async function getContactFormOptions(user: AuthorizableUser) {
  const [organizations, staff] = await Promise.all([
    listContactOptions(user, { organizationsOnly: true }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    organizations: organizations.map((o) => ({ id: o.id, label: o.displayName })),
    staff: staff.map((s) => ({ id: s.id, label: s.name })),
  };
}

export function contactToFormInitial(
  contact: Contact & { phones: ContactPhone[]; emails: ContactEmail[] },
): ContactFormInitial {
  return {
    id: contact.id,
    kind: contact.kind,
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    organizationName: contact.kind === "ORGANIZATION" ? contact.displayName : "",
    organizationId: contact.organizationId ?? "",
    jobTitle: contact.jobTitle ?? "",
    categories: contact.categories,
    phones: contact.phones.map((p) => ({ label: p.label ?? "", number: p.number })),
    emails: contact.emails.map((e) => ({ label: e.label ?? "", address: e.address })),
    addressLine1: contact.addressLine1 ?? "",
    addressLine2: contact.addressLine2 ?? "",
    city: contact.city ?? "",
    state: contact.state ?? "",
    postalCode: contact.postalCode ?? "",
    preferredContactMethod: contact.preferredContactMethod ?? "",
    notes: contact.notes ?? "",
    court: contact.court ?? "",
    jurisdiction: contact.jurisdiction ?? "",
    position: contact.position ?? "",
    assignedStaffId: contact.assignedStaffId ?? "",
  };
}
