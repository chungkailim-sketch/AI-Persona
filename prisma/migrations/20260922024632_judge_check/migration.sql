-- CreateTable
CREATE TABLE "JudgeCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JudgeCheck_projectId_kind_createdAt_idx" ON "JudgeCheck"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "JudgeCheck_targetType_targetId_idx" ON "JudgeCheck"("targetType", "targetId");
