-- CreateTable
CREATE TABLE "HighLevelSyncState" (
    "id" TEXT NOT NULL,
    "lastSuccessfulCheckpoint" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastAttemptedSyncAt" TIMESTAMP(3),
    "runningSince" TIMESTAMP(3),
    "contactsChecked" INTEGER,
    "newLeadsCreated" INTEGER,
    "pendingLeadsUpdated" INTEGER,
    "linkedOrSkipped" INTEGER,
    "failureCount" INTEGER,
    "lastRunOutcome" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HighLevelSyncState_pkey" PRIMARY KEY ("id")
);
