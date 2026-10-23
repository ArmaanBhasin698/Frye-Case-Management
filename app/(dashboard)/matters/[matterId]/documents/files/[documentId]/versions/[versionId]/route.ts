import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";
import { recordActivity } from "@/lib/usage/record";

/**
 * Downloads one specific version of a general matter document. Same
 * posture as the document download route: not signed in, no matter
 * access, a version that doesn't belong to that document *and* matter
 * (forged or stale ids), or bytes that can't be read all return the same
 * generic 404. Every successful download is audited (EXPORT, ids only) and
 * recorded as a DOCUMENT_DOWNLOAD usage event.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ matterId: string; documentId: string; versionId: string }> },
) {
  const { matterId, documentId, versionId } = await params;
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return notFound();
  const path = new URL(request.url).pathname;

  if (!(await hasMatterAccess(user, matterId))) {
    await recordActivity({
      userId: user.id,
      sessionId: user.sessionId,
      type: "ACCESS_DENIED",
      module: "matters",
      path,
      resourceType: "DocumentVersion",
      result: "DENIED",
    });
    return notFound();
  }

  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId, document: { matterId } },
  });
  if (!version) return notFound();

  let bytes: Buffer;
  try {
    bytes = await documentStore.read(version.storageKey);
  } catch {
    return notFound();
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "Document",
      entityId: documentId,
      matterId,
      metadata: { version: version.version, versionId: version.id },
    },
  });
  await recordActivity({
    userId: user.id,
    sessionId: user.sessionId,
    type: "DOCUMENT_DOWNLOAD",
    module: "matters",
    path,
    matterId,
    resourceType: "DocumentVersion",
    resourceId: version.id,
  });

  const filename = (version.originalFilename ?? `document-v${version.version}`).replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": version.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
