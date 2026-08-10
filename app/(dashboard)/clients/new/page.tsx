import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { NewClientForm } from "@/components/shared/new-client-form";

export default async function NewClientPage() {
  const user = await requireCurrentUser();
  assertCanManageClientsAndMatters(user);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">New Client</h1>
        <p className="text-sm text-muted-foreground">
          Fictional/test data only — see CLAUDE.md and docs/SECURITY.md.
        </p>
      </div>
      <NewClientForm />
    </div>
  );
}
