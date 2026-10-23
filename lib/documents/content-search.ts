import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds, hasMatterAccess } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Permission-scoped document *content* search over DocumentTextIndex.
 * The matter scope is part of the SQL WHERE clause, applied before
 * ORDER/LIMIT/OFFSET and before the count — nothing outside the caller's
 * matters is ever fetched, ranked, snippeted, or counted. Only INDEXED
 * rows match (UNSUPPORTED/FAILED never do), and by default only each
 * document's current version is searched. Every value is a bound
 * parameter (Prisma.sql), never string-concatenated.
 */

export const MAX_CONTENT_QUERY_LENGTH = 200;
const HIGHLIGHT_START = "[[";
const HIGHLIGHT_END = "]]";

export type ContentSearchHit = {
  documentId: string;
  matterId: string;
  title: string;
  versionId: string;
  version: number;
  snippet: string;
};

export type ContentSearchOptions = { matterId?: string; take?: number; skip?: number };

export function normalizeContentQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_QUERY_LENGTH);
}

/** Splits a ts_headline snippet into plain-text segments for safe rendering (no HTML). */
export function snippetSegments(snippet: string): { text: string; match: boolean }[] {
  const segments: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    const end = rest.indexOf(HIGHLIGHT_END, start + HIGHLIGHT_START.length);
    if (end === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), match: false });
    segments.push({ text: rest.slice(start + HIGHLIGHT_START.length, end), match: true });
    rest = rest.slice(end + HIGHLIGHT_END.length);
  }
  return segments;
}

/**
 * Builds the scope condition. Returns null when the caller can see no
 * matters (or asked for one they can't access) — the caller answers with
 * an empty result without querying.
 */
export async function contentSearchScope(
  user: AuthorizableUser,
  matterId: string | undefined,
): Promise<Prisma.Sql | null> {
  if (matterId) {
    if (!(await hasMatterAccess(user, matterId))) return null;
    return Prisma.sql`d."matterId" = ${matterId}`;
  }
  if (isAdmin(user)) return Prisma.sql`TRUE`;
  const ids = await getAssignedMatterIds(user.id);
  if (ids.length === 0) return null;
  return Prisma.sql`d."matterId" IN (${Prisma.join(ids)})`;
}

export async function searchDocumentContent(
  user: AuthorizableUser,
  rawQuery: string,
  options: ContentSearchOptions = {},
): Promise<{ hits: ContentSearchHit[]; total: number }> {
  const query = normalizeContentQuery(rawQuery);
  if (query.length < 2) return { hits: [], total: 0 };
  const scope = await contentSearchScope(user, options.matterId);
  if (!scope) return { hits: [], total: 0 };

  const take = Math.min(Math.max(options.take ?? 20, 1), 50);
  const skip = Math.max(options.skip ?? 0, 0);

  const where = Prisma.sql`
    i."status" = 'INDEXED'::"DocumentIndexStatus"
    AND i."text" IS NOT NULL
    AND to_tsvector('english', i."text") @@ plainto_tsquery('english', ${query})
    AND ${scope}`;

  const [hits, countRows] = await Promise.all([
    prisma.$queryRaw<ContentSearchHit[]>`
      SELECT d."id" AS "documentId", d."matterId" AS "matterId", d."title" AS "title",
             v."id" AS "versionId", v."version" AS "version",
             ts_headline('english', i."text", plainto_tsquery('english', ${query}),
               'StartSel=[[, StopSel=]], MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS "snippet"
      FROM "DocumentTextIndex" i
      JOIN "DocumentVersion" v ON v."id" = i."documentVersionId"
      JOIN "Document" d ON d."currentVersionId" = v."id"
      WHERE ${where}
      ORDER BY ts_rank(to_tsvector('english', i."text"), plainto_tsquery('english', ${query})) DESC, d."id" ASC
      LIMIT ${take} OFFSET ${skip}`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "DocumentTextIndex" i
      JOIN "DocumentVersion" v ON v."id" = i."documentVersionId"
      JOIN "Document" d ON d."currentVersionId" = v."id"
      WHERE ${where}`,
  ]);

  return { hits, total: Number(countRows[0]?.count ?? 0) };
}
