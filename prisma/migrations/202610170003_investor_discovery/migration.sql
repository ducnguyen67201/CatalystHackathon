ALTER TABLE "Workspace" ADD COLUMN "discovery" JSONB NOT NULL DEFAULT '{}';

-- Discovery shares the same active-job protection as per-investor checks.
CREATE UNIQUE INDEX "WorkflowJob_active_discovery" ON "WorkflowJob" ("workspaceId", "kind") WHERE "kind" = 'discover-investors' AND "status" IN ('queued', 'running');
