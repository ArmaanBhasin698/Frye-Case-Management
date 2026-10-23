import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { listAccessibleMatterOptions } from "@/lib/contacts/queries";
import { runGlobalSearch } from "@/lib/search";
import { searchDocumentContent, snippetSegments } from "@/lib/documents/content-search";
import {
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  SEARCH_PAGE_SIZE,
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  parseSearchParams,
  searchHref,
} from "@/lib/search/params";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Global search results. All scoping happens in lib/search before
 * counting or paginating; opening a result goes to the normal page, which
 * re-checks authorization on its own.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const raw = await searchParams;
  const parsed = parseSearchParams(raw);
  const matters = await listAccessibleMatterOptions(user);
  const rawQ = (Array.isArray(raw.q) ? raw.q[0] : raw.q) ?? "";
  const p = parsed.ok ? parsed.params : null;
  const outcome = p ? await runGlobalSearch(user, p) : null;
  const totalHits = outcome?.results.reduce((n, r) => n + r.total, 0) ?? 0;
  // Document *contents* use the separate full-text index (lib/documents/
  // content-search.ts), scoped inside its SQL to the viewer's matters.
  const contentResults =
    p && (!p.type || p.type === "documents")
      ? await searchDocumentContent(user, p.q, { matterId: p.matterId, take: 10 })
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Search</h1>
        <p className="text-sm text-muted-foreground">
          Case-insensitive partial matching across records you can access. Exact matches on a record&apos;s main field
          are listed first. The Documents type matches title, filename, and exact tag (metadata); indexed file contents are
          shown separately under “Document contents”.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="s-q" className="text-xs">Search</Label>
          <Input id="s-q" name="q" defaultValue={rawQ} minLength={SEARCH_MIN_LENGTH} maxLength={SEARCH_MAX_LENGTH} className="w-64" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-type" className="text-xs">Type</Label>
          <Select id="s-type" name="type" defaultValue={p?.type ?? ""} className="w-48">
            <option value="">All types</option>
            {SEARCH_TYPES.map((t) => (
              <option key={t} value={t}>{SEARCH_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-matter" className="text-xs">Matter</Label>
          <Select id="s-matter" name="matterId" defaultValue={p?.matterId ?? ""} className="w-48">
            <option value="">Any matter</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>{m.caseNumber} — {m.client.lastName}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-from" className="text-xs">From</Label>
          <Input id="s-from" name="from" type="date" defaultValue={p?.fromDay} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-to" className="text-xs">To</Label>
          <Input id="s-to" name="to" type="date" defaultValue={p?.toDay} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-arch" className="text-xs">Matters</Label>
          <Select id="s-arch" name="archived" defaultValue={p?.archived ?? "active"} className="w-36">
            <option value="active">Active only</option>
            <option value="archived">Archived only</option>
            <option value="all">Active + archived</option>
          </Select>
        </div>
        <Button type="submit" size="sm">Search</Button>
        {p && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/reports/export/search?${searchHref(p).split("?")[1]}`}>Export CSV</Link>
          </Button>
        )}
      </form>

      {!parsed.ok && parsed.reason !== "empty" && (
        <p className="text-sm text-destructive" role="alert">
          {parsed.reason === "too_short"
            ? `Enter at least ${SEARCH_MIN_LENGTH} characters.`
            : `Search text is limited to ${SEARCH_MAX_LENGTH} characters.`}
        </p>
      )}
      {!parsed.ok && parsed.reason === "empty" && (
        <p className="text-sm text-muted-foreground">Enter a name, case number, task, document title, or phrase to search.</p>
      )}

      {p && outcome && (
        <>
          <p className="text-sm text-muted-foreground">
            {totalHits === 0
              ? "No results you have access to."
              : `${totalHits} result${totalHits === 1 ? "" : "s"}${p.type ? ` in ${SEARCH_TYPE_LABELS[p.type]}` : ""}.`}
          </p>
          {outcome.results
            .filter((r) => r.total > 0 || p.type)
            .map((r) => {
              const pageCount = Math.max(1, Math.ceil(r.total / SEARCH_PAGE_SIZE));
              return (
                <Card key={r.type}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <CardTitle className="flex items-center gap-2">
                      {SEARCH_TYPE_LABELS[r.type]} <Badge variant="outline">{r.total}</Badge>
                    </CardTitle>
                    {!p.type && r.total > r.items.length && (
                      <Link href={searchHref(p, { type: r.type, page: undefined })} className="text-sm text-primary hover:underline">
                        See all {r.total}
                      </Link>
                    )}
                  </CardHeader>
                  <CardContent>
                    {r.items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No matches.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {r.items.map((item) => (
                          <li key={item.id} className="py-2 text-sm">
                            <Link href={item.href} className="font-medium hover:underline">{item.title}</Link>
                            <p className="text-xs text-muted-foreground">
                              {[item.subtitle, item.date ? format(item.date, "MMM d, yyyy") : null].filter(Boolean).join(" · ")}
                            </p>
                            {item.snippet && <p className="mt-0.5 text-muted-foreground">{item.snippet}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.type && pageCount > 1 && (
                      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                        <span>Page {r.page} of {pageCount}</span>
                        <div className="flex gap-2">
                          {r.page > 1 && (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={searchHref(p, { page: r.page - 1 })}>Previous</Link>
                            </Button>
                          )}
                          {r.page < pageCount && (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={searchHref(p, { page: r.page + 1 })}>Next</Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </>
      )}

      {contentResults && (
        <Card>
          <CardHeader>
            <CardTitle>Document contents ({contentResults.total})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Full-text matches in the current version of indexed documents (text files, text-layer PDFs, .docx). Scanned
              PDFs and other unsupported formats are never searched. Date and archive filters don&apos;t apply here.
            </p>
          </CardHeader>
          <CardContent>
            {contentResults.hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No document contents match.</p>
            ) : (
              <ul className="divide-y divide-border">
                {contentResults.hits.map((hit) => (
                  <li key={hit.versionId} className="py-2 text-sm">
                    <Link
                      href={`/matters/${hit.matterId}/documents/files/${hit.documentId}/versions/${hit.versionId}`}
                      className="font-medium hover:underline"
                    >
                      {hit.title}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">v{hit.version}</span>
                    <p className="text-xs text-muted-foreground">
                      {snippetSegments(hit.snippet).map((seg, i) =>
                        seg.match ? (
                          <mark key={i} className="bg-amber-100 text-foreground">
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {contentResults.total > contentResults.hits.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the top {contentResults.hits.length}; narrow by matter or use a matter&apos;s document search for more.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
