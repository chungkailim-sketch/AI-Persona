-- AlterTable
ALTER TABLE "ModelCall" ADD COLUMN     "debateId" TEXT;

-- CreateTable
CREATE TABLE "StructuredTable" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL,
    "columns" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "sourceFiles" TEXT[],
    "notes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StructuredTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "contextRunId" TEXT,
    "topic" TEXT NOT NULL,
    "hypothesis" TEXT,
    "focusSegments" TEXT[],
    "rounds" INTEGER NOT NULL DEFAULT 2,
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "agents" JSONB,
    "evidence" JSONB,
    "metrics" JSONB,
    "conclusion" JSONB,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Debate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebateTurn" (
    "id" TEXT NOT NULL,
    "debateId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "phase" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "stance" TEXT,
    "confidence" DOUBLE PRECISION,
    "addressedTo" TEXT[],
    "content" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebateTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StructuredTable_datasetVersionId_idx" ON "StructuredTable"("datasetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "StructuredTable_datasetVersionId_name_key" ON "StructuredTable"("datasetVersionId", "name");

-- CreateIndex
CREATE INDEX "Debate_projectId_createdAt_idx" ON "Debate"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DebateTurn_debateId_seq_key" ON "DebateTurn"("debateId", "seq");

-- CreateIndex
CREATE INDEX "ModelCall_debateId_idx" ON "ModelCall"("debateId");

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructuredTable" ADD CONSTRAINT "StructuredTable_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debate" ADD CONSTRAINT "Debate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debate" ADD CONSTRAINT "Debate_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebateTurn" ADD CONSTRAINT "DebateTurn_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
