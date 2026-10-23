import Link from "next/link";
import { format } from "date-fns";
import type { ContactCategory } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/session";
import { listAccessibleMatterOptions, listContactOptions, listContacts } from "@/lib/contacts/queries";
import { CONTACT_CATEGORY_GROUPS, CONTACT_CATEGORY_LABELS, CONTACT_CATEGORY_VALUES } from "@/lib/contacts/labels";
import { CLIENT_STATUS_LABELS } from "@/lib/contacts/history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Firm-wide contact directory. Every row, filter option, and count comes
 * from queries already restricted to contacts/matters this user may see
 * (lib/contacts/queries.ts) — there's no separate UI-level hiding.
 * Filters are a plain GET form so results are linkable and work without
 * client JavaScript.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const categoryParam = readParam(params.category);
  const category = CONTACT_CATEGORY_VALUES.includes(categoryParam as ContactCategory)
    ? (categoryParam as ContactCategory)
    : undefined;
  const clientStatusParam = readParam(params.clientStatus);
  const filters = {
    q: readParam(params.q) ?? "",
    category,
    organizationId: readParam(params.organizationId) || undefined,
    matterId: readParam(params.matterId) || undefined,
    clientStatus:
      clientStatusParam === "current" || clientStatusParam === "former"
        ? (clientStatusParam as "current" | "former")
        : undefined,
    view: readParam(params.archived) === "1" ? ("archived" as const) : ("active" as const),
    sort: readParam(params.sort) === "recent" ? ("recent" as const) : ("name" as const),
    page: Number.parseInt(readParam(params.page) ?? "1", 10) || 1,
  };

  const [{ rows, total, page, pageSize }, organizations, matters] = await Promise.all([
    listContacts(user, filters),
    listContactOptions(user, { organizationsOnly: true }),
    listAccessibleMatterOptions(user),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(target: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, page: String(target) })) {
      if (key === "view") {
        if (value === "archived") query.set("archived", "1");
      } else if (value && !(key === "sort" && value === "name") && !(key === "page" && value === "1")) {
        query.set(key, String(value));
      }
    }
    const qs = query.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "contact" : "contacts"}
            {filters.view === "archived" ? " archived." : " — current and historical."}
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/contacts/new">New Contact</Link>
        </Button>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {filters.view === "archived" && <input type="hidden" name="archived" value="1" />}
        <div className="space-y-1">
          <Label htmlFor="contacts-q" className="text-xs">
            Search
          </Label>
          <Input id="contacts-q" name="q" className="w-56" defaultValue={filters.q} placeholder="Name, organization, email, phone" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contacts-category" className="text-xs">
            Category
          </Label>
          <Select id="contacts-category" name="category" className="w-48" defaultValue={filters.category ?? ""}>
            <option value="">Any category</option>
            {CONTACT_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.categories.map((c) => (
                  <option key={c} value={c}>
                    {CONTACT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contacts-clientStatus" className="text-xs">
            Client status
          </Label>
          <Select id="contacts-clientStatus" name="clientStatus" className="w-36" defaultValue={filters.clientStatus ?? ""}>
            <option value="">Any</option>
            <option value="current">Current client</option>
            <option value="former">Former client</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contacts-organization" className="text-xs">
            Organization
          </Label>
          <Select id="contacts-organization" name="organizationId" className="w-48" defaultValue={filters.organizationId ?? ""}>
            <option value="">Any organization</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contacts-matter" className="text-xs">
            Associated matter
          </Label>
          <Select id="contacts-matter" name="matterId" className="w-48" defaultValue={filters.matterId ?? ""}>
            <option value="">Any matter</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.caseNumber} — {m.client.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contacts-sort" className="text-xs">
            Sort
          </Label>
          <Select id="contacts-sort" name="sort" className="w-40" defaultValue={filters.sort}>
            <option value="name">Name</option>
            <option value="recent">Recently contacted</option>
          </Select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={filters.view === "archived" ? "/contacts?archived=1" : "/contacts"}>Clear</Link>
        </Button>
      </form>

      <div className="flex gap-2">
        <Button variant={filters.view === "active" ? "default" : "outline"} size="sm" asChild>
          <Link href="/contacts">Active</Link>
        </Button>
        <Button variant={filters.view === "archived" ? "default" : "outline"} size="sm" asChild>
          <Link href="/contacts?archived=1">Archived</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Last contacted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`} className="font-medium text-foreground hover:underline">
                      {contact.displayName}
                    </Link>
                    {contact.jobTitle && <p className="text-xs text-muted-foreground">{contact.jobTitle}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {contact.clientStatus && (
                        <Badge variant={contact.clientStatus === "CURRENT" ? "success" : "secondary"}>
                          {CLIENT_STATUS_LABELS[contact.clientStatus]}
                        </Badge>
                      )}
                      {contact.kind === "ORGANIZATION" && <Badge variant="outline">Organization</Badge>}
                      {contact.categories.map((c) => (
                        <Badge key={c} variant="outline">
                          {CONTACT_CATEGORY_LABELS[c]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {contact.organization ? (
                      <Link href={`/contacts/${contact.organization.id}`} className="hover:underline">
                        {contact.organization.displayName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <p>{contact.phones[0]?.number ?? "—"}</p>
                    {contact.emails[0] && <p>{contact.emails[0].address}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {contact.lastContactedAt ? format(contact.lastContactedAt, "MMM d, yyyy") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No contacts match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page - 1)}>Previous</Link>
              </Button>
            )}
            {page < pageCount && (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page + 1)}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
