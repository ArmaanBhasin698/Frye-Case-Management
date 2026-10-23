import { NextResponse } from "next/server";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/usage/record";
import { hasMatterAccess } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { pdfResponseHeaders } from "@/lib/reports/pdf";
import { loadMatterTimeReport, parseDateRange, renderMatterTimePdf } from "@/lib/reports/time-reports";

/**
 * Matter Time Report PDF. Same denial posture as the document download
 * route: not signed in, bad parameters, no matter access, and nonexistent
 * matter all return the same 404. Rates/amounts are included only for
 * ADMIN. Every successful export is audited (ids and range only).
 */
export async function GET(request: Request) {
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return notFound();

  const url = new URL(request.url);
  const matterId = url.searchParams.get("matterId");
  const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!matterId || !range || !(await hasMatterAccess(user, matterId))) return notFound();

  const data = await loadMatterTimeReport(matterId, range, isAdmin(user));
  if (!data) return notFound();
  const bytes = await renderMatterTimePdf(data);

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "MatterTimeReport",
      entityId: matterId,
      matterId,
      metadata: { from: range.from.toISOString(), to: range.to.toISOString(), entries: data.entries.length },
    },
  });

  await recordActivity({
    userId: user.id,
    sessionId: user.sessionId,
    type: "REPORT_EXPORT",
    module: "reports",
    path: "/reports/pdf/matter-time",
    resourceType: "MatterTimeReport",
    resourceId: matterId,
    matterId,
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: pdfResponseHeaders(`matter-time-${data.matter.caseNumber}-${format(new Date(), "yyyyMMdd")}.pdf`),
  });
}
