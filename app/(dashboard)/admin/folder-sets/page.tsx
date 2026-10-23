import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderSetArchiveButton, FolderSetForm } from "@/components/shared/document-admin-forms";

/** ADMIN-only library of reusable matter folder layouts. */
export default async function FolderSetsAdminPage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const sets = await prisma.documentFolderSet.findMany({
    include: { items: { orderBy: { position: "asc" } } },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Document folder sets</h1>
        <p className="text-sm text-muted-foreground">
          Reusable folder layouts staff can apply to a matter. Applying creates only folders that don&apos;t already exist;
          folders organize documents but never change who can see them.
        </p>
      </div>
      <FolderSetForm />
      {sets.map((set) => (
        <Card key={set.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {set.name}
              {set.archivedAt && <Badge variant="secondary">Archived</Badge>}
            </CardTitle>
            <FolderSetArchiveButton setId={set.id} archived={Boolean(set.archivedAt)} />
          </CardHeader>
          <CardContent>
            <FolderSetForm initial={{ id: set.id, name: set.name, paths: set.items.map((i) => i.path) }} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
