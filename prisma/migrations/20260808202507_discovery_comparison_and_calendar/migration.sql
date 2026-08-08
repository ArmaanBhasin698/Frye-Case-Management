-- CreateEnum
CREATE TYPE "DiscoveryReviewStatus" AS ENUM ('NOT_STARTED', 'IN_REVIEW', 'COMPLETE');

-- CreateEnum
CREATE TYPE "DiscoveryMatchStatus" AS ENUM ('NEW', 'CHANGED', 'DUPLICATE', 'MISSING');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('HEARING', 'DEPOSITION', 'MEETING', 'OTHER');

-- AlterTable
ALTER TABLE "DiscoveryProduction" ADD COLUMN     "reviewStatus" "DiscoveryReviewStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL DEFAULT 'OTHER',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryComparison" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "fromProductionId" TEXT NOT NULL,
    "toProductionId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryFileMatch" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "status" "DiscoveryMatchStatus" NOT NULL,
    "filename" TEXT NOT NULL,
    "identifier" TEXT,
    "fileId" TEXT,
    "notes" TEXT,

    CONSTRAINT "DiscoveryFileMatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComparison" ADD CONSTRAINT "DiscoveryComparison_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComparison" ADD CONSTRAINT "DiscoveryComparison_fromProductionId_fkey" FOREIGN KEY ("fromProductionId") REFERENCES "DiscoveryProduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComparison" ADD CONSTRAINT "DiscoveryComparison_toProductionId_fkey" FOREIGN KEY ("toProductionId") REFERENCES "DiscoveryProduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFileMatch" ADD CONSTRAINT "DiscoveryFileMatch_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "DiscoveryComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFileMatch" ADD CONSTRAINT "DiscoveryFileMatch_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "DiscoveryFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
