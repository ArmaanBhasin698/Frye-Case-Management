import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { getContactForEdit } from "@/lib/contacts/queries";
import { contactToFormInitial, getContactFormOptions } from "@/lib/contacts/form-options";
import { ContactForm } from "@/components/shared/contact-form";

export default async function EditContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const user = await requireCurrentUser();
  const contact = await getContactForEdit(user, contactId);
  if (!contact) notFound();

  const { organizations, staff } = await getContactFormOptions(user);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="page-title">Edit {contact.displayName}</h1>
      <ContactForm
        initial={contactToFormInitial(contact)}
        organizations={organizations}
        staff={staff}
        clientLinked={Boolean(contact.clientId)}
        cancelHref={`/contacts/${contact.id}`}
      />
    </div>
  );
}
