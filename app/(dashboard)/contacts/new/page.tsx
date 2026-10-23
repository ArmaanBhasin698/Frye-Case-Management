import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { hasMatterAccess } from "@/lib/auth/access";
import { getMatterHeader } from "@/lib/matters/queries";
import { matterTitle } from "@/lib/matters/format";
import { getContactFormOptions } from "@/lib/contacts/form-options";
import { EMPTY_CONTACT } from "@/lib/contacts/fields";
import { ContactForm } from "@/components/shared/contact-form";

/**
 * New Contact. With `?matterId=`, the contact is linked to that matter on
 * creation (the "add a new person" path from a matter's Contacts tab) —
 * the matter is access-checked here for the label and again inside
 * `createContact`.
 */
export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const matterId = typeof params.matterId === "string" ? params.matterId : undefined;

  let link: { matterId: string; matterLabel: string } | undefined;
  if (matterId) {
    const matter = await getMatterHeader(matterId);
    if (!matter || !(await hasMatterAccess(user, matter.id))) notFound();
    link = { matterId: matter.id, matterLabel: `${matterTitle(matter)} (${matter.caseNumber})` };
  }

  const { organizations, staff } = await getContactFormOptions(user);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">New Contact</h1>
        <p className="text-sm text-muted-foreground">Fictional/test data only — see CLAUDE.md and docs/SECURITY.md.</p>
      </div>
      <ContactForm
        initial={EMPTY_CONTACT}
        organizations={organizations}
        staff={staff}
        link={link}
        cancelHref={link ? `/matters/${link.matterId}/contacts` : "/contacts"}
      />
    </div>
  );
}
