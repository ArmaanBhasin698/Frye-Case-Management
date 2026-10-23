-- CreateEnum
CREATE TYPE "WorkflowCategory" AS ENUM ('RETAINED_CLIENT_SETUP', 'DISCOVERY_REVIEW', 'HEARING_PREPARATION', 'TRIAL_PREPARATION', 'CLOSURE_FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkflowTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowStepKind" AS ENUM ('TASK', 'EVENT');

-- CreateEnum
CREATE TYPE "WorkflowAssigneeRule" AS ENUM ('UNASSIGNED', 'LEAD_ATTORNEY', 'ASSIGNED_PARALEGAL', 'SPECIFIC_USER');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('MATTER', 'CONTACT', 'CLIENT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT');

-- CreateEnum
CREATE TYPE "SavedReportKind" AS ENUM ('MATTERS', 'TASKS', 'TIME', 'USAGE', 'SEARCH', 'EXPENSES');

-- CreateEnum
CREATE TYPE "DocumentTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentIndexStatus" AS ENUM ('PENDING', 'INDEXED', 'UNSUPPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE', 'TASK_OVERDUE', 'DEADLINE_DUE', 'DEADLINE_OVERDUE', 'EVENT_REMINDER', 'EVENT_CHANGED', 'EVENT_CANCELLED', 'CHAT_DIRECT_MESSAGE');

-- CreateEnum
CREATE TYPE "CalendarExceptionKind" AS ENUM ('CANCELLED', 'MODIFIED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FILING_FEE', 'EXPERT', 'INVESTIGATOR', 'TRANSCRIPT', 'COPIES', 'POSTAGE', 'TRAVEL', 'SERVICE_OF_PROCESS', 'OTHER');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "reminderOffsetsMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "workflowApplicationId" TEXT,
ADD COLUMN     "workflowStepId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "generatedFromTemplateVersionId" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reminderOffsetsMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "workflowApplicationId" TEXT,
ADD COLUMN     "workflowStepId" TEXT;

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "WorkflowCategory" NOT NULL DEFAULT 'OTHER',
    "status" "WorkflowTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplateStep" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "WorkflowStepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "offsetDays" INTEGER NOT NULL,
    "timeOfDay" TEXT,
    "durationMinutes" INTEGER,
    "eventType" "CalendarEventType",
    "assigneeRule" "WorkflowAssigneeRule" NOT NULL DEFAULT 'UNASSIGNED',
    "assigneeUserId" TEXT,

    CONSTRAINT "WorkflowTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowApplication" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalculatedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterStage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterStageChange" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterStageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "matterId" TEXT,
    "contactId" TEXT,
    "clientId" TEXT,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,4),
    "valueBoolean" BOOLEAN,
    "valueDate" TIMESTAMP(3),
    "valueOptionId" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SavedReportKind" NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolder" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolderSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFolderSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolderSetItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "DocumentFolderSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'CORRESPONDENCE',
    "status" "DocumentTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTextIndex" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "status" "DocumentIndexStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "extractor" TEXT,
    "extractedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentTextIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "matterId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerLock" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastOutcome" TEXT,

    CONSTRAINT "SchedulerLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventException" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "kind" "CalendarExceptionKind" NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "title" TEXT,
    "location" TEXT,
    "meetingUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "responsibleUserId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "receiptDocumentId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplateVersion_templateId_version_key" ON "WorkflowTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplateStep_versionId_position_key" ON "WorkflowTemplateStep"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowApplication_requestKey_key" ON "WorkflowApplication"("requestKey");

-- CreateIndex
CREATE INDEX "WorkflowApplication_matterId_idx" ON "WorkflowApplication"("matterId");

-- CreateIndex
CREATE INDEX "MatterStageChange_matterId_changedAt_idx" ON "MatterStageChange"("matterId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_entity_key_key" ON "CustomFieldDefinition"("entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_matterId_key" ON "CustomFieldValue"("definitionId", "matterId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_contactId_key" ON "CustomFieldValue"("definitionId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_clientId_key" ON "CustomFieldValue"("definitionId", "clientId");

-- CreateIndex
CREATE INDEX "SavedReport_ownerId_idx" ON "SavedReport"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolder_matterId_parentId_name_key" ON "DocumentFolder"("matterId", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolderSetItem_setId_path_key" ON "DocumentFolderSetItem"("setId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTextIndex_documentVersionId_key" ON "DocumentTextIndex"("documentVersionId");

-- CreateIndex
CREATE INDEX "Notification_userId_dismissedAt_createdAt_idx" ON "Notification"("userId", "dismissedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_kind_key" ON "NotificationPreference"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerLock_name_key" ON "SchedulerLock"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventException_eventId_originalStart_key" ON "CalendarEventException"("eventId", "originalStart");

-- CreateIndex
CREATE INDEX "Expense_matterId_incurredOn_idx" ON "Expense"("matterId", "incurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowApplicationId_fkey" FOREIGN KEY ("workflowApplicationId") REFERENCES "WorkflowApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "WorkflowTemplateStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_workflowApplicationId_fkey" FOREIGN KEY ("workflowApplicationId") REFERENCES "WorkflowApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "WorkflowTemplateStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_generatedFromTemplateVersionId_fkey" FOREIGN KEY ("generatedFromTemplateVersionId") REFERENCES "DocumentTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplate" ADD CONSTRAINT "WorkflowTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplateVersion" ADD CONSTRAINT "WorkflowTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplateVersion" ADD CONSTRAINT "WorkflowTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplateStep" ADD CONSTRAINT "WorkflowTemplateStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkflowTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTemplateStep" ADD CONSTRAINT "WorkflowTemplateStep_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApplication" ADD CONSTRAINT "WorkflowApplication_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApplication" ADD CONSTRAINT "WorkflowApplication_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "WorkflowTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApplication" ADD CONSTRAINT "WorkflowApplication_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterStageChange" ADD CONSTRAINT "MatterStageChange_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterStageChange" ADD CONSTRAINT "MatterStageChange_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterStageChange" ADD CONSTRAINT "MatterStageChange_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterStageChange" ADD CONSTRAINT "MatterStageChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocumentFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolderSetItem" ADD CONSTRAINT "DocumentFolderSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "DocumentFolderSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTextIndex" ADD CONSTRAINT "DocumentTextIndex_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventException" ADD CONSTRAINT "CalendarEventException_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventException" ADD CONSTRAINT "CalendarEventException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptDocumentId_fkey" FOREIGN KEY ("receiptDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every existing general Document gets an immutable version 1
-- mirroring its current storage columns, and points at it as current.
-- Existing columns are unchanged, so existing links keep working.
INSERT INTO "DocumentVersion" ("id", "documentId", "version", "storageKey", "originalFilename", "mimeType", "sizeBytes", "contentHash", "uploadedById", "createdAt")
SELECT gen_random_uuid()::text, d."id", 1, d."storageKey", d."originalFilename", d."mimeType", d."sizeBytes", d."contentHash", d."uploadedById", d."uploadedAt"
FROM "Document" d;

UPDATE "Document" d
SET "currentVersionId" = v."id"
FROM "DocumentVersion" v
WHERE v."documentId" = d."id" AND v."version" = 1;
