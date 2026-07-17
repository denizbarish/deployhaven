-- AlterTable
ALTER TABLE "ProvisionRun" ADD COLUMN     "error" TEXT;

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "hostKeyFingerprint" TEXT;
