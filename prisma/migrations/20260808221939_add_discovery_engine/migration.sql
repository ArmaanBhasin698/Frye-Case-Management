-- RenameColumn (lib/storage/DocumentStore is storage-agnostic; these were
-- never true Dropbox paths, just fake seeded strings shaped like them)
ALTER TABLE "DiscoveryFile" RENAME COLUMN "dropboxPathOriginal" TO "originalStorageKey";
ALTER TABLE "DiscoveryFile" RENAME COLUMN "dropboxPathNumbered" TO "stampedStorageKey";

-- AlterTable
ALTER TABLE "DiscoveryFile" ADD COLUMN     "batesStart" INTEGER,
ADD COLUMN     "batesEnd" INTEGER,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "registeredById" TEXT,
ADD COLUMN     "registeredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DiscoveryComparison" ADD COLUMN     "runById" TEXT;

-- AddForeignKey
ALTER TABLE "DiscoveryFile" ADD CONSTRAINT "DiscoveryFile_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComparison" ADD CONSTRAINT "DiscoveryComparison_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
