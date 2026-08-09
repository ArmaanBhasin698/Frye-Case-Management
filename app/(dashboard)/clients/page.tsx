import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { listClients } from "@/lib/clients/queries";
import { formatClientName } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function ClientsPage() {
  const user = await requireCurrentUser();
  // Client records are gated by the same conservative role rule as
  // creating a Matter — see lib/auth/authorization.ts#canManageClientsAndMatters
  // and docs/SECURITY.md. PARALEGAL/STAFF still see client info in context
  // via a Matter they're assigned to; this firm-wide roster is ADMIN/ATTORNEY only.
  assertCanManageClientsAndMatters(user);

  const clients = await listClients();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {clients.length} {clients.length === 1 ? "client" : "clients"} on file.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/clients/new">New Client</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Matters</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:underline">
                      {formatClientName(client)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{client.email ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{client.phone ?? "—"}</TableCell>
                  <TableCell>
                    {client.matters.length === 0 ? (
                      <span className="text-sm text-muted-foreground">None yet</span>
                    ) : (
                      <Badge variant="outline">
                        {client.matters.length} {client.matters.length === 1 ? "matter" : "matters"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No clients yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
