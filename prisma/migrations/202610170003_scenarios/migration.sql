CREATE TABLE "ScenarioGeneration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "investorId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL REFERENCES "WorkflowJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "inputHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ScenarioGeneration_jobId_key" ON "ScenarioGeneration"("jobId");
CREATE INDEX "ScenarioGeneration_workspaceId_investorId_createdAt_idx" ON "ScenarioGeneration"("workspaceId", "investorId", "createdAt");
