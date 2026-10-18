CREATE TABLE "GoalJourney" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id"),
  "status" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GoalJourney_workspaceId_status_idx" ON "GoalJourney"("workspaceId", "status");

CREATE TABLE "GoalInvestorTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL REFERENCES "GoalJourney"("id"),
  "investorId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GoalInvestorTarget_workspaceId_journeyId_investorId_key"
  ON "GoalInvestorTarget"("workspaceId", "journeyId", "investorId");
CREATE INDEX "GoalInvestorTarget_workspaceId_journeyId_idx"
  ON "GoalInvestorTarget"("workspaceId", "journeyId");

CREATE TABLE "InvestorMatchAssessment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL REFERENCES "GoalJourney"("id"),
  "investorId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InvestorMatchAssessment_workspaceId_journeyId_investorId_createdAt_idx"
  ON "InvestorMatchAssessment"("workspaceId", "journeyId", "investorId", "createdAt");

CREATE TABLE "GoalPreparationScope" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL REFERENCES "GoalJourney"("id"),
  "version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GoalPreparationScope_workspaceId_journeyId_version_key"
  ON "GoalPreparationScope"("workspaceId", "journeyId", "version");

CREATE TABLE "GoalProgressEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL REFERENCES "GoalJourney"("id"),
  "sequence" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "targetIds" TEXT[] NOT NULL,
  "payload" JSONB NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GoalProgressEvent_workspaceId_journeyId_sequence_key"
  ON "GoalProgressEvent"("workspaceId", "journeyId", "sequence");
CREATE INDEX "GoalProgressEvent_workspaceId_journeyId_recordedAt_sequence_idx"
  ON "GoalProgressEvent"("workspaceId", "journeyId", "recordedAt", "sequence");
