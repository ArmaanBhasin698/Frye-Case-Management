import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { getIntakeLeadById } from "@/lib/intake/queries";
import { listClientsForPicker } from "@/lib/clients/queries";
import {
  CreateClientFromIntakeLeadForm,
  DismissIntakeLeadForm,
  LinkIntakeLeadForm,
} from "@/components/shared/intake-lead-review";

export default async function IntakeLeadReviewPage({
  params,
}: {
  params: Promise<{ intakeLeadId: string }>;
}) {
  const user = await requireCurrentUser();
  assertCanManageClientsAndMatters(user);

  const { intakeLeadId } = await params;
  const lead = await getIntakeLeadById(intakeLeadId);
  // A lead that's already LINKED/DISMISSED has nothing left to review —
  // same not-found-not-forbidden treatment as every other access check in
  // this app (see lib/auth/access.ts).
  if (!lead || lead.status !== "PENDING") {
    notFound();
  }

  const clients = await listClientsForPicker();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">
          Review: {lead.firstName} {lead.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          From Loop/HighLevel · received {lead.receivedAt.toLocaleString()}
        </p>
      </div>

      <div className="grid gap-1.5 rounded-lg border border-border bg-card p-4 text-sm">
        <div>
          <span className="text-muted-foreground">Email:</span> {lead.email ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Phone:</span> {lead.phone ?? "—"}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Link to an existing client</h2>
        <LinkIntakeLeadForm intakeLeadId={lead.id} clients={clients} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Or create a new client</h2>
        <CreateClientFromIntakeLeadForm
          lead={{ id: lead.id, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone }}
        />
      </section>

      <section className="border-t border-border pt-4">
        <DismissIntakeLeadForm intakeLeadId={lead.id} />
      </section>
    </div>
  );
}
