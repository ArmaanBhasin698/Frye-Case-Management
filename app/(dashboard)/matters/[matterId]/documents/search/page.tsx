import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { MAX_CONTENT_QUERY_LENGTH, searchDocumentContent, snippetSegments } from "@/lib/documents/content-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 20;

/**
 * Searches the extracted text of this matter's current document versions.
 * Only text, text-layer PDF, and .docx files are indexed; scanned PDFs and
 * other formats are never reported as matches.
 */
export default async function DocumentContentSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);

  const { hits, total } = q.trim()
    ? await searchDocumentContent(user, q, { matterId, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE })
    : { hits: [], total: 0 };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/matters/${matterId}/documents/search?q=${encodeURIComponent(q)}&page=${p}`;

  return (
    <div className="space-y-4">
      <Link href={`/matters/${matterId}/documents`} className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Documents
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Search document contents</CardTitle>
          <p className="text-xs text-muted-foreground">
            Searches text extracted from plain-text, text-layer PDF, and Word (.docx) files on this matter (current versions).
            Scanned PDFs, images, legacy .doc, and spreadsheets are not searchable.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex gap-2">
            <Input name="q" defaultValue={q} maxLength={MAX_CONTENT_QUERY_LENGTH} placeholder="e.g. body cam" className="max-w-md" />
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>
          {q.trim() && (
            <p className="text-sm text-muted-foreground">
              {total} matching {total === 1 ? "document" : "documents"} (all words must appear; word stems match).
            </p>
          )}
          <ul className="space-y-3">
            {hits.map((hit) => (
              <li key={hit.versionId} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {hit.title} <span className="text-xs text-muted-foreground">v{hit.version}</span>
                  </span>
                  <Link
                    href={`/matters/${matterId}/documents/files/${hit.documentId}/versions/${hit.versionId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Download
                  </Link>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {snippetSegments(hit.snippet).map((seg, i) =>
                    seg.match ? (
                      <mark key={i} className="rounded bg-amber-100 px-0.5 text-foreground">
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
          {pages > 1 && (
            <div className="flex gap-2">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={href(page - 1)}>Previous</Link>
                </Button>
              )}
              {page < pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={href(page + 1)}>Next</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
