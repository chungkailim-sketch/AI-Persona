-- AlterTable
ALTER TABLE "Brief" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "buildError" TEXT,
ADD COLUMN     "buildStatus" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'cohort';

-- AlterTable
ALTER TABLE "ModelCall" ADD COLUMN     "cohortId" TEXT,
ADD COLUMN     "roundtableId" TEXT;

-- AlterTable
ALTER TABLE "PersonaVersion" ADD COLUMN     "profile" JSONB;

-- CreateTable
CREATE TABLE "Roundtable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "categories" TEXT[],
    "context" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "summary" JSONB,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Roundtable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundtableAnswer" (
    "id" TEXT NOT NULL,
    "roundtableId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "overall" DOUBLE PRECISION,
    "quote" TEXT,
    "scores" JSONB,
    "conditions" TEXT[],
    "barriers" TEXT[],
    "profile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundtableAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketInput" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "brand" DOUBLE PRECISION,
    "geoTrade" DOUBLE PRECISION,
    "spending" DOUBLE PRECISION,
    "categoryDemand" DOUBLE PRECISION,
    "scrutiny" DOUBLE PRECISION,
    "digital" DOUBLE PRECISION,
    "source" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Roundtable_projectId_createdAt_idx" ON "Roundtable"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoundtableAnswer_roundtableId_personaId_key" ON "RoundtableAnswer"("roundtableId", "personaId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketInput_projectId_market_key" ON "MarketInput"("projectId", "market");

-- CreateIndex
CREATE INDEX "ModelCall_cohortId_idx" ON "ModelCall"("cohortId");

-- CreateIndex
CREATE INDEX "ModelCall_roundtableId_idx" ON "ModelCall"("roundtableId");

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_roundtableId_fkey" FOREIGN KEY ("roundtableId") REFERENCES "Roundtable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roundtable" ADD CONSTRAINT "Roundtable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roundtable" ADD CONSTRAINT "Roundtable_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundtableAnswer" ADD CONSTRAINT "RoundtableAnswer_roundtableId_fkey" FOREIGN KEY ("roundtableId") REFERENCES "Roundtable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketInput" ADD CONSTRAINT "MarketInput_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
