-- CreateTable
CREATE TABLE "ForecastAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "horizon" INTEGER NOT NULL DEFAULT 1,
    "groups" TEXT[],
    "seriesCount" INTEGER NOT NULL DEFAULT 0,
    "droppedSeries" INTEGER NOT NULL DEFAULT 0,
    "periods" TEXT[],
    "gatePassed" BOOLEAN NOT NULL DEFAULT false,
    "gate" JSONB,
    "backtest" JSONB,
    "trends" JSONB,
    "forecasts" JSONB,
    "modelName" TEXT NOT NULL DEFAULT 'baseline',
    "modelVersion" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ForecastAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastAnalysis_projectId_createdAt_idx" ON "ForecastAnalysis"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ForecastAnalysis_datasetVersionId_idx" ON "ForecastAnalysis"("datasetVersionId");
