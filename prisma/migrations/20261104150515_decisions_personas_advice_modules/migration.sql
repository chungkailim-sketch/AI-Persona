-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "parameters" JSONB;

-- AlterTable
ALTER TABLE "ModelCall" ADD COLUMN     "adviceId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "useCase" TEXT NOT NULL DEFAULT 'market_entry';

-- CreateTable
CREATE TABLE "DecisionCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "subjectId" TEXT,
    "input" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "modelId" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaChat" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" JSONB,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Advice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMS_PLAN',
    "question" TEXT NOT NULL,
    "options" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "content" JSONB,
    "sources" JSONB,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionCheck_projectId_checkpoint_createdAt_idx" ON "DecisionCheck"("projectId", "checkpoint", "createdAt");

-- CreateIndex
CREATE INDEX "PersonaChat_personaId_createdAt_idx" ON "PersonaChat"("personaId", "createdAt");

-- CreateIndex
CREATE INDEX "Advice_projectId_createdAt_idx" ON "Advice"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_adviceId_idx" ON "ModelCall"("adviceId");

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_adviceId_fkey" FOREIGN KEY ("adviceId") REFERENCES "Advice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionCheck" ADD CONSTRAINT "DecisionCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaChat" ADD CONSTRAINT "PersonaChat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
