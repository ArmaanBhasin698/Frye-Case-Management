import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";

/**
 * Streams a registered discovery file's bytes — either the untouched
 * original or (for PDFs) the Bates-stamped derivative, chosen via
 * `?variant=original|stamped`. Every failure mode (not logged in, no
 * matter access, wrong matter, file doesn't exist, content never stored)
 * returns the same generic 404 so this endpoint can't be used to probe for
 * what exists (see docs/SECURITY.md's "Authorization" section).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matterId: string; fileId: string }> },
) {
  const { matterId, fileId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Not found.", { status: 404 });
  }

  if (!(await hasMatterAccess(user, matterId))) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const file = await prisma.discoveryFile.findFirst({
    where: { id: fileId, production: { matterId } },
  });
  if (!file) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const variant = request.nextUrl.searchParams.get("variant") === "stamped" ? "stamped" : "original";
  const storageKey = variant === "stamped" ? file.stampedStorageKey : file.originalStorageKey;
  if (!storageKey) {
    return new NextResponse("Not found.", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await documentStore.read(storageKey);
  } catch {
    return new NextResponse("Not found.", { status: 404 });
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "DiscoveryFile",
      entityId: file.id,
      matterId,
      metadata: { variant },
    },
  });

  const filename = variant === "stamped" ? `stamped-${file.originalFilename}` : file.originalFilename;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
