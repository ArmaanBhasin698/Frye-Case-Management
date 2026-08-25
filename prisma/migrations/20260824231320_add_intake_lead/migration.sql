-- CreateEnum
CREATE TYPE "IntakeLeadStatus" AS ENUM ('PENDING', 'LINKED', 'DISMISSED');

-- CreateTable
CREATE TABLE "IntakeLead" (
    "id" TEXT NOT NULL,
    "provider" "ExternalLeadProvider" NOT NULL,
    "externalContactId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "IntakeLeadStatus" NOT NULL DEFAULT 'PENDING',
    "linkedClientId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeLead_status_idx" ON "IntakeLead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeLead_provider_externalContactId_key" ON "IntakeLead"("provider", "externalContactId");

-- AddForeignKey
ALTER TABLE "IntakeLead" ADD CONSTRAINT "IntakeLead_linkedClientId_fkey" FOREIGN KEY ("linkedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeLead" ADD CONSTRAINT "IntakeLead_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
