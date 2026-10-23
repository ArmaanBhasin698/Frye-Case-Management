-- CreateEnum
CREATE TYPE "ProceedingType" AS ENUM ('ARRAIGNMENT', 'BOND_HEARING', 'MOTION_HEARING', 'PRETRIAL_CONFERENCE', 'PLEA_HEARING', 'TRIAL', 'SENTENCING', 'PROBATION_HEARING', 'OTHER');

-- CreateEnum
CREATE TYPE "RulingIssueType" AS ENUM ('MOTION_TO_SUPPRESS', 'MOTION_TO_DISMISS', 'BOND_MODIFICATION', 'DISCOVERY_MOTION', 'EVIDENTIARY_MOTION', 'CONTINUANCE', 'SENTENCING', 'PROBATION_MOTION', 'JURY_INSTRUCTION', 'OTHER_MOTION');

-- CreateEnum
CREATE TYPE "RulingResult" AS ENUM ('GRANTED', 'DENIED', 'PARTIALLY_GRANTED', 'WITHDRAWN', 'MOOT', 'TAKEN_UNDER_ADVISEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('PROCEDURAL_OBSERVATION', 'SUBJECTIVE_IMPRESSION', 'LESSON_LEARNED');

-- CreateEnum
CREATE TYPE "ObservationCategory" AS ENUM ('HEARING_PROCEDURE', 'SCHEDULING', 'COURTROOM_MANAGEMENT', 'EVIDENTIARY', 'LEGAL_ISSUE', 'NEGOTIATION', 'COMMUNICATION', 'PREPARATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ObservationShareScope" AS ENUM ('MATTER_ONLY', 'FIRM_ATTORNEYS');

-- CreateEnum
CREATE TYPE "ClosureReviewStatus" AS ENUM ('NOT_APPLICABLE', 'NEEDS_BACKFILL', 'COMPLETE');

-- CreateEnum
CREATE TYPE "CaseDisposition" AS ENUM ('DISMISSAL', 'ACQUITTAL', 'CONVICTION', 'PLEA_AGREEMENT', 'DIVERSION', 'NOLLE_PROSEQUI', 'DEFERRED_ADJUDICATION', 'ADMINISTRATIVE_CLOSURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ResolutionProcedure" AS ENUM ('TRIAL', 'PLEA', 'DISMISSAL', 'DIVERSION', 'OTHER');

-- CreateEnum
CREATE TYPE "TrialType" AS ENUM ('BENCH', 'JURY');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MeetingProvider" AS ENUM ('ZOOM', 'MICROSOFT_TEAMS', 'GOOGLE_MEET', 'WEBEX', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TimeActivityCategory" AS ENUM ('LEGAL_RESEARCH', 'DISCOVERY_REVIEW', 'DOCUMENT_REVIEW', 'DRAFTING', 'COURT_PREPARATION', 'COURT_APPEARANCE', 'TRIAL_WORK', 'CLIENT_COMMUNICATION', 'CONSULTATION', 'WITNESS_INTERVIEW', 'INVESTIGATION', 'INTERNAL_DISCUSSION', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('MANUAL', 'TIMER');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('LOGOUT', 'EXPIRED', 'REVOKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGOUT', 'SESSION_START', 'SESSION_EXPIRED', 'PAGE_VIEW', 'MATTER_VIEW', 'DOCUMENT_DOWNLOAD', 'REPORT_EXPORT', 'DATA_CHANGE', 'ADMIN_ACTION', 'ACCESS_DENIED');

-- CreateEnum
CREATE TYPE "ActivityResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "ChatConversationType" AS ENUM ('CHANNEL', 'DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('MATTER', 'TEAM', 'DEPARTMENT', 'GENERAL', 'TOPIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CalendarEventType" ADD VALUE 'CLIENT_MEETING';
ALTER TYPE "CalendarEventType" ADD VALUE 'INTERNAL_MEETING';
ALTER TYPE "CalendarEventType" ADD VALUE 'TRIAL';
ALTER TYPE "CalendarEventType" ADD VALUE 'CONSULTATION';
ALTER TYPE "CalendarEventType" ADD VALUE 'VIRTUAL_MEETING';
ALTER TYPE "CalendarEventType" ADD VALUE 'PHONE_CALL';
ALTER TYPE "CalendarEventType" ADD VALUE 'FILING_DEADLINE';
ALTER TYPE "CalendarEventType" ADD VALUE 'DISCOVERY_DEADLINE';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "allDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "meetingProvider" "MeetingProvider",
ADD COLUMN     "meetingUrl" TEXT,
ADD COLUMN     "recurrenceCount" INTEGER,
ADD COLUMN     "recurrenceFrequency" "RecurrenceFrequency" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurrenceUntil" TIMESTAMP(3),
ADD COLUMN     "reminderMinutesBefore" INTEGER,
ADD COLUMN     "status" "CalendarEventStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
ALTER COLUMN "matterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "closureReviewStatus" "ClosureReviewStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- CreateTable
CREATE TABLE "JudicialRuling" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "judgeContactId" TEXT NOT NULL,
    "rulingDate" TIMESTAMP(3) NOT NULL,
    "court" TEXT NOT NULL,
    "proceedingType" "ProceedingType" NOT NULL,
    "issueType" "RulingIssueType" NOT NULL,
    "issueDetail" TEXT,
    "result" "RulingResult" NOT NULL,
    "context" TEXT,
    "documentId" TEXT,
    "closureReportId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "correctionReason" TEXT,

    CONSTRAINT "JudicialRuling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalObservation" (
    "id" TEXT NOT NULL,
    "subjectContactId" TEXT NOT NULL,
    "matterId" TEXT,
    "authorId" TEXT,
    "category" "ObservationCategory" NOT NULL,
    "kind" "ObservationKind" NOT NULL,
    "body" TEXT NOT NULL,
    "references" TEXT,
    "shareScope" "ObservationShareScope" NOT NULL DEFAULT 'MATTER_ONLY',
    "closureReportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "correctionReason" TEXT,

    CONSTRAINT "ProfessionalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterClosureReport" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "amendmentReason" TEXT,
    "isHistoricalBackfill" BOOLEAN NOT NULL DEFAULT false,
    "responsibleAttorneyId" TEXT,
    "closingAttorneyId" TEXT,
    "closureDate" TIMESTAMP(3) NOT NULL,
    "caseType" TEXT,
    "charges" TEXT NOT NULL,
    "disposition" "CaseDisposition" NOT NULL,
    "dispositionDetail" TEXT,
    "outcomeDate" TIMESTAMP(3),
    "resolutionProcedure" "ResolutionProcedure" NOT NULL,
    "outcomeSummary" TEXT NOT NULL,
    "judgeContactId" TEXT,
    "prosecutorContactId" TEXT,
    "opposingCounselContactId" TEXT,
    "noSignificantRulings" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT,
    "finalNotes" TEXT,
    "lessonsLearned" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterClosureReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialOutcome" (
    "id" TEXT NOT NULL,
    "closureReportId" TEXT NOT NULL,
    "trialStartDate" TIMESTAMP(3) NOT NULL,
    "trialEndDate" TIMESTAMP(3),
    "trialType" "TrialType" NOT NULL,
    "defenseAttorneys" TEXT,
    "chargesTried" TEXT NOT NULL,
    "verdicts" JSONB NOT NULL,
    "evidentiaryIssues" TEXT,
    "significantMotions" TEXT,
    "sentencingOutcome" TEXT,
    "trialSummary" TEXT NOT NULL,
    "attorneyObservations" TEXT,
    "lessonsLearned" TEXT,

    CONSTRAINT "TrialOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventContact" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "category" "TimeActivityCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "hourlyRateCents" INTEGER,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "source" "TimeEntrySource" NOT NULL DEFAULT 'MANUAL',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveTimer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "category" "TimeActivityCategory",
    "description" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "runningSince" TIMESTAMP(3),
    "accumulatedSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActiveTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "SessionEndReason",
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "type" "ActivityEventType" NOT NULL,
    "module" TEXT,
    "path" TEXT,
    "matterId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "result" "ActivityResult" NOT NULL DEFAULT 'SUCCESS',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityMinute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "module" TEXT,
    "matterId" TEXT,

    CONSTRAINT "UserActivityMinute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "type" "ChatConversationType" NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "channelKind" "ChatChannelKind",
    "matterId" TEXT,
    "participantKey" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMembership" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "matterRefId" TEXT,
    "documentRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JudicialRuling_supersedesId_key" ON "JudicialRuling"("supersedesId");

-- CreateIndex
CREATE INDEX "JudicialRuling_judgeContactId_supersededAt_idx" ON "JudicialRuling"("judgeContactId", "supersededAt");

-- CreateIndex
CREATE INDEX "JudicialRuling_matterId_idx" ON "JudicialRuling"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalObservation_supersedesId_key" ON "ProfessionalObservation"("supersedesId");

-- CreateIndex
CREATE INDEX "ProfessionalObservation_subjectContactId_supersededAt_idx" ON "ProfessionalObservation"("subjectContactId", "supersededAt");

-- CreateIndex
CREATE INDEX "ProfessionalObservation_matterId_idx" ON "ProfessionalObservation"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "MatterClosureReport_matterId_version_key" ON "MatterClosureReport"("matterId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TrialOutcome_closureReportId_key" ON "TrialOutcome"("closureReportId");

-- CreateIndex
CREATE INDEX "CalendarEventAttendee_userId_idx" ON "CalendarEventAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventAttendee_eventId_userId_key" ON "CalendarEventAttendee"("eventId", "userId");

-- CreateIndex
CREATE INDEX "CalendarEventContact_contactId_idx" ON "CalendarEventContact"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventContact_eventId_contactId_key" ON "CalendarEventContact"("eventId", "contactId");

-- CreateIndex
CREATE INDEX "TimeEntry_matterId_workDate_idx" ON "TimeEntry"("matterId", "workDate");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_workDate_idx" ON "TimeEntry"("userId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveTimer_userId_key" ON "ActiveTimer"("userId");

-- CreateIndex
CREATE INDEX "UserSession_userId_startedAt_idx" ON "UserSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "UserActivityEvent_userId_occurredAt_idx" ON "UserActivityEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "UserActivityEvent_type_occurredAt_idx" ON "UserActivityEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "UserActivityEvent_occurredAt_idx" ON "UserActivityEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "UserActivityMinute_minute_idx" ON "UserActivityMinute"("minute");

-- CreateIndex
CREATE UNIQUE INDEX "UserActivityMinute_userId_minute_key" ON "UserActivityMinute"("userId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_participantKey_key" ON "ChatConversation"("participantKey");

-- CreateIndex
CREATE INDEX "ChatConversation_matterId_idx" ON "ChatConversation"("matterId");

-- CreateIndex
CREATE INDEX "ChatMembership_userId_idx" ON "ChatMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMembership_conversationId_userId_key" ON "ChatMembership"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_startTime_idx" ON "CalendarEvent"("startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_matterId_idx" ON "CalendarEvent"("matterId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_judgeContactId_fkey" FOREIGN KEY ("judgeContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_closureReportId_fkey" FOREIGN KEY ("closureReportId") REFERENCES "MatterClosureReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudicialRuling" ADD CONSTRAINT "JudicialRuling_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "JudicialRuling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalObservation" ADD CONSTRAINT "ProfessionalObservation_subjectContactId_fkey" FOREIGN KEY ("subjectContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalObservation" ADD CONSTRAINT "ProfessionalObservation_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalObservation" ADD CONSTRAINT "ProfessionalObservation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalObservation" ADD CONSTRAINT "ProfessionalObservation_closureReportId_fkey" FOREIGN KEY ("closureReportId") REFERENCES "MatterClosureReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalObservation" ADD CONSTRAINT "ProfessionalObservation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ProfessionalObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_responsibleAttorneyId_fkey" FOREIGN KEY ("responsibleAttorneyId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_closingAttorneyId_fkey" FOREIGN KEY ("closingAttorneyId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_judgeContactId_fkey" FOREIGN KEY ("judgeContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_prosecutorContactId_fkey" FOREIGN KEY ("prosecutorContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClosureReport" ADD CONSTRAINT "MatterClosureReport_opposingCounselContactId_fkey" FOREIGN KEY ("opposingCounselContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialOutcome" ADD CONSTRAINT "TrialOutcome_closureReportId_fkey" FOREIGN KEY ("closureReportId") REFERENCES "MatterClosureReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventContact" ADD CONSTRAINT "CalendarEventContact_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventContact" ADD CONSTRAINT "CalendarEventContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityMinute" ADD CONSTRAINT "UserActivityMinute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityMinute" ADD CONSTRAINT "UserActivityMinute_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityMinute" ADD CONSTRAINT "UserActivityMinute_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMembership" ADD CONSTRAINT "ChatMembership_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMembership" ADD CONSTRAINT "ChatMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_matterRefId_fkey" FOREIGN KEY ("matterRefId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_documentRefId_fkey" FOREIGN KEY ("documentRefId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Matters that were already closed before the structured closure workflow
-- existed have no closure report. Flag them for manual backfill; never
-- fabricate a report.
UPDATE "Matter" SET "closureReviewStatus" = 'NEEDS_BACKFILL' WHERE "status" = 'CLOSED';
