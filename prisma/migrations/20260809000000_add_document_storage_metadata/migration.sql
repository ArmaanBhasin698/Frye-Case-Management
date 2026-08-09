-- Rename Document.dropboxPath to storageKey (same type, same values — the
-- field always held an opaque DocumentStore key, never a literal Dropbox
-- API path; the old name was misleading now that STORAGE_PROVIDER can be
-- "local"). Then add nullable metadata columns needed for real upload/
-- download support: originalFilename, mimeType, sizeBytes, contentHash.
-- All four are nullable so this migration is purely additive for existing
-- rows (seeded documents keep storageKey, leave the rest null, and remain
-- illustrative-only, same as pre-engine DiscoveryFile rows).
ALTER TABLE "Document" RENAME COLUMN "dropboxPath" TO "storageKey";
ALTER TABLE "Document" ADD COLUMN "originalFilename" TEXT;
ALTER TABLE "Document" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "Document" ADD COLUMN "sizeBytes" INTEGER;
ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT;
