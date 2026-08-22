-- CreateEnum
CREATE TYPE "ExternalLeadProvider" AS ENUM ('LOOP_HIGHLEVEL');

-- CreateTable
CREATE TABLE "ExternalLeadLink" (
    "id" TEXT NOT NULL,
    "provider" "ExternalLeadProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalLeadLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalLeadLink_clientId_idx" ON "ExternalLeadLink"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLeadLink_provider_externalId_key" ON "ExternalLeadLink"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_vonageCallId_key" ON "Call"("vonageCallId");

-- AddForeignKey
ALTER TABLE "ExternalLeadLink" ADD CONSTRAINT "ExternalLeadLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

