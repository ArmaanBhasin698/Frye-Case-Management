import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanEditMatter } from "@/lib/auth/access";
import { getMatterForEdit, listAssignableUsers } from "@/lib/matters/queries";
import { matterTitle } from "@/lib/matters/format";
import { EditMatterForm } from "@/components/shared/edit-matter-form";
import { ManageAssignments } from "@/components/shared/manage-assignments";

export default async function EditMatterPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const user = await requireCurrentUser();

  // The parent matter layout already asserted matter-level access; this
  // adds the Client/Matter management role check on top (ADMIN, or an
  // ATTORNEY assigned to this matter — see
  // lib/auth/access.ts#canEditMatter). A PARALEGAL/STAFF user, or an
  // ATTORNEY not assigned here, gets the same not-found page.
  await assertCanEditMatter(user, matterId);

  const [matter, staff] = await Promise.all([getMatterForEdit(matterId), listAssignableUsers()]);
  if (!matter) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {matterTitle(matter)}</h1>
        <p className="text-sm text-muted-foreground">{matter.caseNumber}</p>
      </div>
      <EditMatterForm matter={matter} />
      <ManageAssignments matterId={matterId} assignments={matter.assignments} staff={staff} />
    </div>
  );
}
