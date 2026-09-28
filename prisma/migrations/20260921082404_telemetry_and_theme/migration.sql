-- AlterTable
ALTER TABLE "User" ADD COLUMN     "themePreference" TEXT NOT NULL DEFAULT 'system';

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "seq" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetVersionId" TEXT,
    "cohortId" TEXT,
    "runId" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "progressCurrent" INTEGER,
    "progressTotal" INTEGER,
    "metricName" TEXT,
    "metricValue" DOUBLE PRECISION,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "safeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryEvent_eventId_key" ON "TelemetryEvent"("eventId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_projectId_seq_idx" ON "TelemetryEvent"("projectId", "seq");

-- CreateIndex
CREATE INDEX "TelemetryEvent_runId_seq_idx" ON "TelemetryEvent"("runId", "seq");

-- CreateIndex
CREATE INDEX "TelemetryEvent_datasetVersionId_seq_idx" ON "TelemetryEvent"("datasetVersionId", "seq");

-- CreateIndex
CREATE INDEX "TelemetryEvent_cohortId_seq_idx" ON "TelemetryEvent"("cohortId", "seq");
