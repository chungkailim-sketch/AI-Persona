-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'RESEARCH_ADMIN', 'PRESET_MANAGER', 'AUDITOR', 'SUPPORT', 'STANDARD_USER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'COLLABORATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowStep" AS ENUM ('DATA', 'BRIEF', 'PERSONAS', 'SIMULATION', 'RESULTS');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('AWAITING_UPLOAD', 'UPLOADING', 'SCANNING', 'PARSING', 'PROFILING', 'MAPPING', 'VALIDATING', 'DETECTING_SENSITIVE', 'READY_FOR_REVIEW', 'IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "LawfulBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGITIMATE_INTEREST', 'PUBLIC_TASK', 'LEGAL_OBLIGATION', 'NOT_APPLICABLE_AGGREGATE');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CLIENT_CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMERIC', 'ORDINAL', 'CATEGORICAL', 'BOOLEAN', 'DATE', 'IDENTIFIER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SensitivityClass" AS ENUM ('NONE', 'PII', 'SPECIAL_CATEGORY');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'COMPLETE');

-- CreateEnum
CREATE TYPE "PersonaType" AS ENUM ('CONSUMER', 'PROFESSIONAL', 'MODERATOR');

-- CreateEnum
CREATE TYPE "PersonaMode" AS ENUM ('RESPONDENT', 'CLUSTER', 'HYBRID', 'CONFIGURED');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('DRAFT', 'CANDIDATE', 'APPROVED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "AttributeOrigin" AS ENUM ('OBSERVED', 'DERIVED', 'INFERRED', 'USER_ENTERED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('DRAFT', 'VALIDATING', 'QUEUED', 'PREPARING_CONTEXT', 'GENERATING_PERSONAS', 'INDEPENDENT_ASSESSMENT', 'CONSUMER_REACTION', 'CROSS_EXAMINATION', 'REVISION', 'SYNTHESIS', 'REPORT', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SimulationMode" AS ENUM ('SINGLE_CONCEPT', 'AB_COMPARISON', 'MULTIVARIATE', 'STRUCTURED_SURVEY', 'OPEN_ENDED', 'PERSONA_INTERVIEW', 'PROFESSIONAL_PANEL', 'RED_TEAM', 'SCENARIO_PLANNING', 'FOCUS_GROUP', 'COUNTERFACTUAL', 'SENSITIVITY', 'FORECAST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'STALLED');

-- CreateEnum
CREATE TYPE "EvidenceGrade" AS ENUM ('L1_OBSERVED', 'L2_DERIVED', 'L3_PERSONA_SIMULATION', 'L4_SCENARIO_INFERENCE', 'L5_SPECULATION');

-- CreateEnum
CREATE TYPE "FindingClassification" AS ENUM ('CONFIRMED', 'PROBABLE', 'CONTESTED', 'MINORITY_RETAINED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "VoteType" AS ENUM ('CONFIRM', 'DISPUTE', 'ABSTAIN');

-- CreateTable
CREATE TABLE "ApprovedDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ApprovedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "systemRole" "SystemRole" NOT NULL DEFAULT 'STANDARD_USER',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "requestIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "userAgentHash" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" "WorkflowStep" NOT NULL DEFAULT 'DATA',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'VIEWER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "DatasetStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "checksum" TEXT,
    "rowCount" INTEGER,
    "cellCount" INTEGER,
    "parseReport" JSONB,
    "qualityScore" INTEGER,
    "derivedFromId" TEXT,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sheetName" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'NOT_SCANNED',
    "scanProvider" TEXT NOT NULL DEFAULT 'none',
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetField" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'UNKNOWN',
    "typeConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scalePoints" INTEGER,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "missingPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outlierCount" INTEGER NOT NULL DEFAULT 0,
    "distinctCount" INTEGER NOT NULL DEFAULT 0,
    "sensitivity" "SensitivityClass" NOT NULL DEFAULT 'NONE',
    "sensitivityReason" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "inclusionJustification" TEXT,
    "constructMappingGrade" TEXT,
    "profile" JSONB,

    CONSTRAINT "DatasetField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityComponent" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "QualityComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityFinding" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "IntegrityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceRecord" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "dataOwner" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "collectionStart" TIMESTAMP(3),
    "collectionEnd" TIMESTAMP(3),
    "geography" TEXT[],
    "language" TEXT[],
    "methodology" TEXT NOT NULL,
    "sampleSize" INTEGER,
    "lawfulBasis" "LawfulBasis" NOT NULL,
    "classification" "DataClassification" NOT NULL DEFAULT 'INTERNAL',
    "permittedUses" TEXT[],
    "allowModelProcessing" BOOLEAN NOT NULL DEFAULT false,
    "restrictions" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "expiresAt" TIMESTAMP(3),
    "sensitiveConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "GovernanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDataset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceChunk" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "locatorType" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "fieldName" TEXT,
    "value" TEXT,
    "numericValue" DOUBLE PRECISION,
    "baseSize" INTEGER,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "pageNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "businessContext" TEXT,
    "researchQuestion" TEXT,
    "objective" TEXT,
    "decisionSupported" TEXT,
    "targetAudience" TEXT,
    "markets" TEXT[],
    "geography" TEXT[],
    "languages" TEXT[],
    "culturalContext" TEXT,
    "timePeriod" TEXT,
    "channels" TEXT[],
    "competitors" TEXT[],
    "desiredOutcome" TEXT,
    "evaluationMetrics" TEXT[],
    "riskDimensions" TEXT[],
    "constraints" TEXT,
    "exclusions" TEXT[],
    "prohibitedInferences" TEXT[],
    "personaCount" INTEGER NOT NULL DEFAULT 12,
    "personaComposition" JSONB,
    "simulationDepth" TEXT NOT NULL DEFAULT 'standard',
    "runCount" INTEGER NOT NULL DEFAULT 3,
    "confidenceRequirement" TEXT,
    "resultFormat" TEXT,
    "reportAudience" TEXT,
    "coverageAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "operationalDefinition" TEXT,
    "nullHypothesis" TEXT,
    "minimumEvidenceThreshold" TEXT NOT NULL,
    "alternativeExplanations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stimulus" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'text',
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stimulus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "PersonaMode" NOT NULL DEFAULT 'HYBRID',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generationNote" TEXT,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT,
    "type" "PersonaType" NOT NULL,
    "externalKey" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaVersion" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "approval" "ApprovalState" NOT NULL DEFAULT 'DRAFT',
    "mode" "PersonaMode" NOT NULL,
    "summary" TEXT,
    "segment" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseSize" INTEGER,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "coverageNote" TEXT,
    "allowedAttributes" TEXT[],
    "disallowedAttributes" TEXT[],
    "contradictions" TEXT[],
    "purpose" TEXT,
    "challengeQuestions" TEXT[],
    "biasGuard" TEXT,
    "outputSchemaKey" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "diffFromId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaAttribute" (
    "id" TEXT NOT NULL,
    "personaVersionId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "origin" "AttributeOrigin" NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "baseSize" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PersonaAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "briefId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "SimulationMode" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "isPartial" BOOLEAN NOT NULL DEFAULT false,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunConfig" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "cohortId" TEXT,
    "planHash" TEXT NOT NULL,
    "seeds" INTEGER[],
    "runCount" INTEGER NOT NULL DEFAULT 3,
    "modelId" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4000,
    "promptVersions" JSONB NOT NULL,
    "metrics" TEXT[],
    "evaluatorKeys" TEXT[],
    "stimulusIds" TEXT[],
    "blindLabelMap" JSONB,
    "budgetCapUsd" DOUBLE PRECISION,
    "estimatedCostUsd" DOUBLE PRECISION,
    "safetySettings" JSONB,
    "stopConditions" JSONB,
    "forecastGate" JSONB,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "RunConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunConfigDataset" (
    "id" TEXT NOT NULL,
    "runConfigId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,

    CONSTRAINT "RunConfigDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stage" "RunStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "outputRef" JSONB,
    "errorCategory" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "input" JSONB NOT NULL,
    "output" JSONB,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "stage" TEXT NOT NULL,
    "personaKey" TEXT,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptTemplate" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "seed" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL,
    "errorCategory" TEXT,
    "schemaValid" BOOLEAN NOT NULL DEFAULT true,
    "evidenceManifestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedResponse" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "personaKey" TEXT NOT NULL,
    "stimulusId" TEXT,
    "seed" INTEGER NOT NULL,
    "responseType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sentiment" TEXT,
    "scores" JSONB,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "authorPersonaKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "evidenceGrade" "EvidenceGrade" NOT NULL,
    "confidence" TEXT NOT NULL,
    "severity" TEXT,
    "judgementOnly" BOOLEAN NOT NULL DEFAULT false,
    "baseSizes" JSONB,
    "segments" TEXT[],
    "classification" "FindingClassification",
    "consensusRatio" DOUBLE PRECISION,
    "priorityScore" DOUBLE PRECISION,
    "materiality" TEXT,
    "limitations" TEXT,
    "recommendation" TEXT,
    "round" INTEGER NOT NULL DEFAULT 1,
    "revisedFromId" TEXT,
    "revisionJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRef" (
    "id" TEXT NOT NULL,
    "evidenceChunkId" TEXT NOT NULL,
    "findingId" TEXT,
    "personaAttributeId" TEXT,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,

    CONSTRAINT "EvidenceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaVote" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "personaKey" TEXT NOT NULL,
    "vote" "VoteType" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 2,
    "challenge" TEXT,
    "citedEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntiHerdMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "flipRate" DOUBLE PRECISION NOT NULL,
    "voteEntropy" DOUBLE PRECISION NOT NULL,
    "convergenceRounds" INTEGER NOT NULL,
    "dissentSurvival" DOUBLE PRECISION NOT NULL,
    "warningRaised" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AntiHerdMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Synthesis" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "directAnswer" TEXT NOT NULL,
    "qualifiedRecommendation" TEXT NOT NULL,
    "confidenceBasis" TEXT NOT NULL,
    "groupthinkWarning" BOOLEAN NOT NULL DEFAULT false,
    "overrideNote" TEXT,
    "limitations" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Synthesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "synthesisId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "expectedImpact" DOUBLE PRECISION NOT NULL,
    "confidenceWeight" DOUBLE PRECISION NOT NULL,
    "consensusWeight" DOUBLE PRECISION NOT NULL,
    "rankScore" DOUBLE PRECISION NOT NULL,
    "executionDifficulty" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'action',

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dissent" (
    "id" TEXT NOT NULL,
    "synthesisId" TEXT NOT NULL,
    "personaKey" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "findingId" TEXT,

    CONSTRAINT "Dissent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "reviewerAckById" TEXT,
    "reviewerAckAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "outputSchemaKey" TEXT NOT NULL,
    "changelog" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PersonaType" NOT NULL,
    "purpose" TEXT NOT NULL,
    "focusAreas" TEXT[],
    "challengeQuestions" TEXT[],
    "biasGuard" TEXT NOT NULL,
    "outputSchemaKey" TEXT NOT NULL,
    "requiresCitation" BOOLEAN NOT NULL DEFAULT true,
    "canBlockExport" BOOLEAN NOT NULL DEFAULT false,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "enabledByDefault" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "lockedFields" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationMetric" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "scaleMin" INTEGER NOT NULL DEFAULT 0,
    "scaleMax" INTEGER NOT NULL DEFAULT 100,
    "applicableModes" "SimulationMode"[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EvaluationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'all',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "classification" "DataClassification" NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "hardDelete" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "projectId" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT,
    "ipHash" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "runId" TEXT,
    "sessionId" TEXT,
    "properties" JSONB,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedDomain_domain_key" ON "ApprovedDomain"("domain");

-- CreateIndex
CREATE INDEX "ApprovedDomain_active_idx" ON "ApprovedDomain"("active");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_systemRole_idx" ON "User"("systemRole");

-- CreateIndex
CREATE INDEX "OtpChallenge_email_createdAt_idx" ON "OtpChallenge"("email", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Project_workspaceId_status_idx" ON "Project"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Project_createdById_idx" ON "Project"("createdById");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Dataset_workspaceId_deletedAt_idx" ON "Dataset"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "DatasetVersion_status_idx" ON "DatasetVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetVersion_datasetId_versionNo_key" ON "DatasetVersion"("datasetId", "versionNo");

-- CreateIndex
CREATE INDEX "SourceFile_datasetVersionId_idx" ON "SourceFile"("datasetVersionId");

-- CreateIndex
CREATE INDEX "DatasetField_datasetVersionId_idx" ON "DatasetField"("datasetVersionId");

-- CreateIndex
CREATE INDEX "DatasetField_sensitivity_idx" ON "DatasetField"("sensitivity");

-- CreateIndex
CREATE INDEX "QualityComponent_datasetVersionId_idx" ON "QualityComponent"("datasetVersionId");

-- CreateIndex
CREATE INDEX "IntegrityFinding_datasetVersionId_severity_idx" ON "IntegrityFinding"("datasetVersionId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceRecord_datasetVersionId_key" ON "GovernanceRecord"("datasetVersionId");

-- CreateIndex
CREATE INDEX "GovernanceRecord_expiresAt_idx" ON "GovernanceRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDataset_projectId_datasetId_key" ON "ProjectDataset"("projectId", "datasetId");

-- CreateIndex
CREATE INDEX "EvidenceChunk_datasetVersionId_locatorType_idx" ON "EvidenceChunk"("datasetVersionId", "locatorType");

-- CreateIndex
CREATE INDEX "EvidenceChunk_fieldName_idx" ON "EvidenceChunk"("fieldName");

-- CreateIndex
CREATE UNIQUE INDEX "Brief_projectId_versionNo_key" ON "Brief"("projectId", "versionNo");

-- CreateIndex
CREATE INDEX "Hypothesis_briefId_idx" ON "Hypothesis"("briefId");

-- CreateIndex
CREATE INDEX "Stimulus_briefId_idx" ON "Stimulus"("briefId");

-- CreateIndex
CREATE INDEX "Cohort_projectId_idx" ON "Cohort"("projectId");

-- CreateIndex
CREATE INDEX "Persona_cohortId_type_idx" ON "Persona"("cohortId", "type");

-- CreateIndex
CREATE INDEX "PersonaVersion_approval_idx" ON "PersonaVersion"("approval");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaVersion_personaId_versionNo_key" ON "PersonaVersion"("personaId", "versionNo");

-- CreateIndex
CREATE INDEX "PersonaAttribute_personaVersionId_group_idx" ON "PersonaAttribute"("personaVersionId", "group");

-- CreateIndex
CREATE INDEX "Run_projectId_status_idx" ON "Run"("projectId", "status");

-- CreateIndex
CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunConfig_runId_key" ON "RunConfig"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RunConfigDataset_runConfigId_datasetVersionId_key" ON "RunConfigDataset"("runConfigId", "datasetVersionId");

-- CreateIndex
CREATE INDEX "RunStep_runId_stage_idx" ON "RunStep"("runId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_sequence_key" ON "RunStep"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_availableAt_idx" ON "Job"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Job_runId_idx" ON "Job"("runId");

-- CreateIndex
CREATE INDEX "ModelCall_runId_stage_idx" ON "ModelCall"("runId", "stage");

-- CreateIndex
CREATE INDEX "ModelCall_createdAt_idx" ON "ModelCall"("createdAt");

-- CreateIndex
CREATE INDEX "SimulatedResponse_runId_personaKey_idx" ON "SimulatedResponse"("runId", "personaKey");

-- CreateIndex
CREATE INDEX "Finding_runId_classification_idx" ON "Finding"("runId", "classification");

-- CreateIndex
CREATE INDEX "EvidenceRef_findingId_idx" ON "EvidenceRef"("findingId");

-- CreateIndex
CREATE INDEX "EvidenceRef_personaAttributeId_idx" ON "EvidenceRef"("personaAttributeId");

-- CreateIndex
CREATE INDEX "PersonaVote_findingId_idx" ON "PersonaVote"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaVote_findingId_personaKey_round_key" ON "PersonaVote"("findingId", "personaKey", "round");

-- CreateIndex
CREATE INDEX "AntiHerdMetric_runId_idx" ON "AntiHerdMetric"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Synthesis_runId_key" ON "Synthesis"("runId");

-- CreateIndex
CREATE INDEX "Recommendation_synthesisId_rank_idx" ON "Recommendation"("synthesisId", "rank");

-- CreateIndex
CREATE INDEX "Dissent_synthesisId_idx" ON "Dissent"("synthesisId");

-- CreateIndex
CREATE INDEX "ReportExport_runId_idx" ON "ReportExport"("runId");

-- CreateIndex
CREATE INDEX "PromptTemplate_key_status_idx" ON "PromptTemplate"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ModelSetting_key_key" ON "ModelSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaTemplate_key_key" ON "PersonaTemplate"("key");

-- CreateIndex
CREATE INDEX "Preset_kind_active_idx" ON "Preset"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationMetric_key_key" ON "EvaluationMetric"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_classification_key" ON "RetentionPolicy"("classification");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_idx" ON "AuditEvent"("projectId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetField" ADD CONSTRAINT "DatasetField_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityComponent" ADD CONSTRAINT "QualityComponent_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityFinding" ADD CONSTRAINT "IntegrityFinding_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceRecord" ADD CONSTRAINT "GovernanceRecord_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDataset" ADD CONSTRAINT "ProjectDataset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDataset" ADD CONSTRAINT "ProjectDataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceChunk" ADD CONSTRAINT "EvidenceChunk_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stimulus" ADD CONSTRAINT "Stimulus_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaVersion" ADD CONSTRAINT "PersonaVersion_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaAttribute" ADD CONSTRAINT "PersonaAttribute_personaVersionId_fkey" FOREIGN KEY ("personaVersionId") REFERENCES "PersonaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunConfig" ADD CONSTRAINT "RunConfig_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunConfig" ADD CONSTRAINT "RunConfig_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunConfigDataset" ADD CONSTRAINT "RunConfigDataset_runConfigId_fkey" FOREIGN KEY ("runConfigId") REFERENCES "RunConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunConfigDataset" ADD CONSTRAINT "RunConfigDataset_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatedResponse" ADD CONSTRAINT "SimulatedResponse_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_evidenceChunkId_fkey" FOREIGN KEY ("evidenceChunkId") REFERENCES "EvidenceChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_personaAttributeId_fkey" FOREIGN KEY ("personaAttributeId") REFERENCES "PersonaAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaVote" ADD CONSTRAINT "PersonaVote_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntiHerdMetric" ADD CONSTRAINT "AntiHerdMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Synthesis" ADD CONSTRAINT "Synthesis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_synthesisId_fkey" FOREIGN KEY ("synthesisId") REFERENCES "Synthesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dissent" ADD CONSTRAINT "Dissent_synthesisId_fkey" FOREIGN KEY ("synthesisId") REFERENCES "Synthesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
