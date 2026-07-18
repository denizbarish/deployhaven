-- AlterTable: add runId to group ProvisionRun rows by provisioning attempt.
-- Existing rows are backfilled with their own id (each legacy row becomes its
-- own single-row run) so the NOT NULL constraint can be applied safely.
ALTER TABLE "ProvisionRun" ADD COLUMN "runId" TEXT;
UPDATE "ProvisionRun" SET "runId" = "id" WHERE "runId" IS NULL;
ALTER TABLE "ProvisionRun" ALTER COLUMN "runId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ProvisionRun_serverId_runId_idx" ON "ProvisionRun"("serverId", "runId");
