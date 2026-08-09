import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { listClientsForPicker } from "@/lib/clients/queries";
import { listAssignableUsers } from "@/lib/matters/queries";
import { NewMatterForm } from "@/components/shared/new-matter-form";

export default async function NewMatterPage() {
  const user = await requireCurrentUser();
  // Only ADMIN/ATTORNEY may originate a new matter — see
  // lib/auth/authorization.ts#canManageClientsAndMatters and
  // docs/SECURITY.md. A PARALEGAL/STAFF user hitting this URL directly
  // gets the same not-found page as any other unauthorized route.
  assertCanManageClientsAndMatters(user);

  const [clients, staff] = await Promise.all([listClientsForPicker(), listAssignableUsers()]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Matter</h1>
        <p className="text-sm text-muted-foreground">
          Open a new matter for an existing client and assign the staff working it.
        </p>
      </div>
      <NewMatterForm clients={clients} staff={staff} />
    </div>
  );
}
