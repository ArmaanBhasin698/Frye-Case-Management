import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { listContactOptions, listMatterContacts } from "@/lib/contacts/queries";
import { CONTACT_CATEGORY_LABELS } from "@/lib/contacts/labels";
import { asCalendarDate } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddMatterContactForm, RemoveMatterContactButton } from "@/components/shared/matter-contacts";

/**
 * Everyone involved in this matter — the client, judges, prosecutors,
 * officers, witnesses, family. Re-asserts matter access itself rather than
 * relying only on the matter layout, since this page reads matter data.
 */
export default async function MatterContactsPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const [{ links, client }, contactOptions] = await Promise.all([
    listMatterContacts(matterId),
    listContactOptions(user),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">People and organizations on this matter</h2>
        <AddMatterContactForm
          matterId={matterId}
          contacts={contactOptions.map((c) => ({ id: c.id, label: c.displayName }))}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Involved</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {client && (
                <TableRow>
                  <TableCell>
                    {client.contact ? (
                      <Link href={`/contacts/${client.contact.id}`} className="font-medium hover:underline">
                        {client.firstName} {client.lastName}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {client.firstName} {client.lastName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge>Client</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">See client record</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell />
                </TableRow>
              )}
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>
                    <Link href={`/contacts/${link.contact.id}`} className="font-medium hover:underline">
                      {link.contact.displayName}
                    </Link>
                    {(link.contact.jobTitle || link.contact.organization) && (
                      <p className="text-xs text-muted-foreground">
                        {[link.contact.jobTitle, link.contact.organization?.displayName].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{CONTACT_CATEGORY_LABELS[link.role]}</Badge>
                    {link.roleDetail && <p className="mt-1 text-xs text-muted-foreground">{link.roleDetail}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <p>{link.contact.phones[0]?.number ?? "—"}</p>
                    {link.contact.emails[0] && <p>{link.contact.emails[0].address}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {link.startDate ? format(asCalendarDate(link.startDate), "MMM d, yyyy") : "—"}
                    {link.endDate ? ` – ${format(asCalendarDate(link.endDate), "MMM d, yyyy")}` : ""}
                  </TableCell>
                  <TableCell>
                    <RemoveMatterContactButton matterContactId={link.id} />
                  </TableCell>
                </TableRow>
              ))}
              {links.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No other contacts linked yet — add judges, prosecutors, officers, witnesses, and family here.
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
