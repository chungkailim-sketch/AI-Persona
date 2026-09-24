-- CreateTable
CREATE TABLE "PopulationSample" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "primaryGroup" TEXT NOT NULL,
    "secondaryGroup" TEXT,
    "spec" JSONB NOT NULL,
    "quotas" JSONB NOT NULL,
    "calibration" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "assumptions" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopulationSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PopulationSample_projectId_createdAt_idx" ON "PopulationSample"("projectId", "createdAt");
