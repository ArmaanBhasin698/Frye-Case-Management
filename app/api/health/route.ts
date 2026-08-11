import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Minimal, unauthenticated health/readiness probe for host monitoring
 * (excluded from proxy.ts's auth gate — see its matcher). Deliberately
 * returns nothing beyond two fixed-shape status strings: no database
 * URL, no package/runtime versions, no row counts, no user or case data,
 * no stack traces. A DB failure is reduced to "unreachable" — the actual
 * error (which could include connection details) is never surfaced in
 * the response, only in the server's own log.
 */
export async function GET() {
  let db: "ok" | "unreachable" = "unreachable";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "ok";
  } catch (error) {
    console.error("Health check: database unreachable", error);
    db = "unreachable";
  }

  const healthy = db === "ok";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", db }, { status: healthy ? 200 : 503 });
}
