import { NextResponse } from "next/server";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { pdfResponseHeaders } from "@/lib/reports/pdf";
import { loadFirmUtilization, parseDateRange, renderFirmUtilizationPdf } from "@/lib/reports/time-reports";

/** Firm Utilization Report PDF — ADMIN only; every other caller gets the generic 404. */
export async function GET(request: Request) {
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return notFound();

  const url = new URL(request.url);
  const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!range) return notFound();

  const data = await loadFirmUtilization(range);
  const bytes = await renderFirmUtilizationPdf(data);

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "FirmUtilizationReport",
      entityId: "firm",
      metadata: { from: range.from.toISOString(), to: range.to.toISOString(), entries: data.entries.length },
    },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: pdfResponseHeaders(`firm-utilization-${format(new Date(), "yyyyMMdd")}.pdf`),
  });
}
