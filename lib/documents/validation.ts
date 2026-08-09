/**
 * Common law-office file types this demo accepts. Keyed by extension
 * (the primary check — browsers/OSes are inconsistent about reporting
 * `file.type`) with the MIME types normally associated with it as a
 * secondary, permissive check. Files are only ever stored and served back
 * byte-for-byte — never executed, previewed, or transformed — so this
 * allowlist is about keeping the demo to ordinary case documents, not a
 * security control against malicious content.
 *
 * Kept out of lib/documents/actions.ts because that file is a "use server"
 * module — every export there must be an async Server Action, so this
 * plain sync helper (and its test) live here instead.
 */
const ALLOWED_EXTENSIONS: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt: ["text/plain"],
  rtf: ["application/rtf", "text/rtf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
};

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export function isAllowedDocumentFile(filename: string, mimeType: string): boolean {
  const allowedMimes = ALLOWED_EXTENSIONS[fileExtension(filename)];
  if (!allowedMimes) return false;
  // Some browsers/OSes omit or generically report file.type — the
  // extension allowlist above is the real gate; a present, mismatched,
  // *specific* MIME type is treated as suspicious and rejected.
  if (!mimeType || mimeType === "application/octet-stream") return true;
  return allowedMimes.includes(mimeType);
}
