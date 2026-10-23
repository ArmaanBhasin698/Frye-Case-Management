import { after } from "next/server";

import { indexDocumentVersion } from "@/lib/documents/indexing";

/**
 * Runs content indexing after the response is sent, so a slow or failing
 * extraction never blocks or fails the upload that triggered it. Outside a
 * request scope (scripts), it just runs in the background.
 */
export function scheduleIndexing(versionId: string): void {
  try {
    after(() => indexDocumentVersion(versionId));
  } catch {
    void indexDocumentVersion(versionId);
  }
}
