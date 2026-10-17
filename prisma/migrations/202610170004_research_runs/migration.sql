CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "investorId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ResearchRun_workspaceId_createdAt_id_idx" ON "ResearchRun"("workspaceId", "createdAt", "id");
CREATE INDEX "ResearchRun_workspaceId_investorId_createdAt_idx" ON "ResearchRun"("workspaceId", "investorId", "createdAt");
CREATE INDEX "ResearchRun_workspaceId_jobId_idx" ON "ResearchRun"("workspaceId", "jobId");
