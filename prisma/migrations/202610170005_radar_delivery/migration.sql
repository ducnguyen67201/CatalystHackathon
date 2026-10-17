ALTER TABLE "Workspace" ADD COLUMN "notificationSettings" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "radarBackfilledAt" TIMESTAMP(3);
CREATE TABLE "RadarEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id"),
  "dedupeKey" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RadarEvent_workspaceId_dedupeKey_key" ON "RadarEvent"("workspaceId", "dedupeKey");
CREATE INDEX "RadarEvent_workspaceId_createdAt_id_idx" ON "RadarEvent"("workspaceId", "createdAt", "id");
CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id"),
  "eventId" TEXT, "recipientRevision" INTEGER NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NotificationDelivery_workspaceId_eventId_recipientRevision_key" ON "NotificationDelivery"("workspaceId", "eventId", "recipientRevision");
CREATE TABLE "WorkerHeartbeat" (
  "workspaceId" TEXT NOT NULL PRIMARY KEY REFERENCES "Workspace"("id"), "payload" JSONB NOT NULL
);
