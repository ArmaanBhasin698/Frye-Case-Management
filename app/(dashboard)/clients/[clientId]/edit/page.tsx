import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { getClientById } from "@/lib/clients/queries";
import { formatClientName } from "@/lib/matters/format";
import { EditClientForm } from "@/components/shared/edit-client-form";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await requireCurrentUser();
  assertCanManageClientsAndMatters(user);

  const client = await getClientById(clientId);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {formatClientName(client)}</h1>
      </div>
      <EditClientForm client={client} />
    </div>
  );
}
