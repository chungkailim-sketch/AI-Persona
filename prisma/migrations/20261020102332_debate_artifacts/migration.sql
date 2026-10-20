-- CreateTable
CREATE TABLE "DebateArtifact" (
    "id" TEXT NOT NULL,
    "debateId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agentKey" TEXT,
    "prompt" TEXT,
    "options" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "content" JSONB,
    "evidence" JSONB,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DebateArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebateArtifact_debateId_kind_createdAt_idx" ON "DebateArtifact"("debateId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "DebateArtifact" ADD CONSTRAINT "DebateArtifact_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
