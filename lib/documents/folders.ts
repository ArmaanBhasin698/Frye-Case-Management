/**
 * Pure folder helpers — path parsing for folder sets and cycle checks for
 * moves. Folders are metadata only: moving a document or folder never
 * touches stored bytes or changes who can access the document (that is
 * always the matter's access rule).
 */

export const MAX_FOLDER_DEPTH = 4;
export const MAX_FOLDER_NAME = 100;

export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Folder name is required.";
  if (trimmed.length > MAX_FOLDER_NAME) return "Folder name is too long.";
  if (trimmed.includes("/")) return "Folder names can't contain '/'.";
  return null;
}

/** "Discovery / Body cam" → ["Discovery", "Body cam"]; null if invalid. */
export function parseFolderPath(path: string): string[] | null {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_FOLDER_DEPTH) return null;
  if (segments.some((s) => validateFolderName(s) !== null)) return null;
  return segments;
}

/** One path per line; blank lines ignored; duplicates removed; invalid lines reported. */
export function parseFolderSetPaths(text: string): { paths: string[]; invalid: string[] } {
  const paths: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const segments = parseFolderPath(line);
    if (!segments) {
      invalid.push(line.trim());
      continue;
    }
    const normalized = segments.join("/");
    if (!seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      paths.push(normalized);
    }
  }
  return { paths, invalid };
}

type FolderNode = { id: string; parentId: string | null };

/** True if `candidateParentId` is `folderId` itself or one of its descendants (a move would create a cycle). */
export function wouldCreateCycle(folders: FolderNode[], folderId: string, candidateParentId: string | null): boolean {
  let current = candidateParentId;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const guard = new Set<string>();
  while (current) {
    if (current === folderId) return true;
    if (guard.has(current)) return true;
    guard.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export function folderDepth(folders: FolderNode[], folderId: string | null): number {
  let depth = 0;
  let current = folderId;
  const byId = new Map(folders.map((f) => [f.id, f]));
  while (current && depth <= MAX_FOLDER_DEPTH + 1) {
    depth += 1;
    current = byId.get(current)?.parentId ?? null;
  }
  return depth;
}

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;

/** "Exhibit, privileged , exhibit" → ["exhibit", "privileged"] (lower-cased, de-duplicated). */
export function parseTags(input: string): { tags: string[]; error: string | null } {
  const tags = [...new Set(input.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > MAX_TAGS) return { tags: [], error: `At most ${MAX_TAGS} tags.` };
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) return { tags: [], error: "Tags must be 40 characters or fewer." };
  return { tags, error: null };
}

/** Starter folder set for fictional development data (lead wires into prisma/seed.ts). */
export const STARTER_FOLDER_SET = {
  name: "Criminal defense — standard (starter)",
  paths: [
    "Pleadings",
    "Correspondence",
    "Discovery Notes",
    "Discovery Notes/Body cam & video",
    "Motions",
    "Investigation",
    "Client Documents",
    "Court Orders",
  ],
};
