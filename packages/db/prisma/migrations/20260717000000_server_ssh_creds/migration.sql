-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "sshKeyCipher" TEXT,
ADD COLUMN     "sshPort" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN     "sshUser" TEXT NOT NULL DEFAULT 'root';

