import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";

/**
 * Streams a general matter document's original bytes. Same posture as
 * app/(dashboard)/matters/[matterId]/discovery/files/[fileId]/route.ts:
 * every failure mode (not logged in, no matter access, wrong matter,
 * document doesn't exist, content never stored) returns the same generic
 * 404 so this endpoint can't be used to probe for what exists (see
 * docs/SECURITY.md's "Authorization" section). Route Handlers don't
 * inherit the matter layout's access check, so this repeats it itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matterId: string; documentId: string }> },
) {
  const { matterId, documentId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Not found.", { status: 404 });
  }

  if (!(await hasMatterAccess(user, matterId))) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const document = await prisma.document.findFirst({ where: { id: documentId, matterId } });
  if (!document) {
    return new NextResponse("Not found.", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await documentStore.read(document.storageKey);
  } catch {
    // Covers both "never actually stored" (pre-tenth-session seeded rows)
    // and any real storage-layer failure — neither should leak detail to
    // the client.
    return new NextResponse("Not found.", { status: 404 });
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "Document",
      entityId: document.id,
      matterId,
    },
  });

  const filename = (document.originalFilename ?? document.title).replace(/"/g, "");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": document.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
