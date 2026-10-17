CREATE TABLE "TrackedInvestor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackedInvestor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrackedInvestor_workspaceId_key_key" ON "TrackedInvestor"("workspaceId", "key");
CREATE INDEX "TrackedInvestor_workspaceId_createdAt_idx" ON "TrackedInvestor"("workspaceId", "createdAt");

-- At most one active check per investor, across API and worker processes.
CREATE UNIQUE INDEX "WorkflowJob_active_investor_key" ON "WorkflowJob"("workspaceId", "kind")
WHERE "kind" LIKE 'investor:%' AND "status" IN ('queued', 'running');
