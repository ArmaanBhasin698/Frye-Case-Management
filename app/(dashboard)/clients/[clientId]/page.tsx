import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { getClientById } from "@/lib/clients/queries";
import { formatClientName, matterStatusLabel, matterStatusVariant, matterTitle } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveClientButton } from "@/components/shared/archive-client-button";

export default async function ClientDetailPage({
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clients" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; All clients
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{formatClientName(client)}</h1>
            {client.archived && <Badge variant="secondary">Archived</Badge>}
          </div>
          {client.archived && client.archivedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Archived {format(client.archivedAt, "MMM d, yyyy")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/clients/${client.id}/edit`}>Edit Client</Link>
          </Button>
          <ArchiveClientButton clientId={client.id} archived={client.archived} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>
              <span className="text-muted-foreground">Date of birth: </span>
              {client.dateOfBirth ? format(client.dateOfBirth, "MMM d, yyyy") : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Email: </span>
              {client.email ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone: </span>
              {client.phone ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Address: </span>
              {client.address ?? "—"}
            </p>
            {client.notes && (
              <p className="pt-2 text-muted-foreground">{client.notes}</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Matters</CardTitle>
          </CardHeader>
          <CardContent>
            {client.matters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matters yet for this client.</p>
            ) : (
              <ul className="divide-y divide-border">
                {client.matters.map((matter) => (
                  <li key={matter.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/matters/${matter.id}`} className="min-w-0">
                      <p className="text-sm font-medium text-foreground hover:underline">
                        {matterTitle({ caseNumber: matter.caseNumber, client })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {matter.caseNumber} &middot; {matter.charges}
                      </p>
                    </Link>
                    <Badge variant={matterStatusVariant(matter.status)}>{matterStatusLabel(matter.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
