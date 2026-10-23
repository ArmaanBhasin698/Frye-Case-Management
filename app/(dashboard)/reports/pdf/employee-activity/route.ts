import { NextResponse } from "next/server";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { pdfResponseHeaders } from "@/lib/reports/pdf";
import { parseDateRange } from "@/lib/reports/time-reports";
import { loadEmployeeActivity, renderEmployeeActivityPdf } from "@/lib/reports/employee-activity";

/**
 * Employee Activity Report PDF — ADMIN only (employee-monitoring data is
 * restricted to administrators). Generic 404 for every denial, including
 * an unknown userId.
 */
export async function GET(request: Request) {
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return notFound();

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!userId || !range) return notFound();

  const data = await loadEmployeeActivity(userId, range);
  if (!data) return notFound();
  const bytes = await renderEmployeeActivityPdf(data);

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "EmployeeActivityReport",
      entityId: userId,
      metadata: { from: range.from.toISOString(), to: range.to.toISOString() },
    },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: pdfResponseHeaders(`employee-activity-${format(new Date(), "yyyyMMdd")}.pdf`),
  });
}
