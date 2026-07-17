import { Worker } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SshRunner } from "./ssh-runner.js";
import { runPipeline, type StepResult } from "./module.js";
import { buildModules } from "./provision.pipeline.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

/**
 * Bir StepResult'ı ProvisionRun satırına eşler (saf, test edilebilir).
 * FIND-008: hata mesajı yalnızca `failed` durumunda kalıcı olur; aksi halde null.
 */
export function toProvisionRunData(serverId: string, step: StepResult) {
  return {
    serverId,
    step: step.id,
    status: step.status,
    error: step.status === "failed" ? step.error ?? null : null,
  };
}

export function startProvisionWorker(getCreds: (serverId: string) => Promise<{
  host: string; user: string; port: number; privateKey: string; hostKeyFingerprint: string | null;
}>, opts: { publicKey: string; acmeEmail: string }) {
  return new Worker(
    PROVISION_QUEUE,
    async (job) => {
      const { serverId } = job.data as { serverId: string };
      const creds = await getCreds(serverId);
      const runner = await SshRunner.connect({
        host: creds.host,
        port: creds.port,
        username: creds.user,
        privateKey: creds.privateKey,
        expectedFingerprint: creds.hostKeyFingerprint,
      });
      // FIND-001 TOFU: ilk bağlantıda gözlenen host-key fingerprint'ini pinle.
      // updateMany + hostKeyFingerprint:null koşulu ile atomik: eşzamanlı iki job'da
      // yalnızca ilk yazan kazanır, sonrakiler mevcut pini ezmez.
      if (!creds.hostKeyFingerprint && runner.hostKeyFingerprint) {
        await prisma.server.updateMany({
          where: { id: serverId, hostKeyFingerprint: null },
          data: { hostKeyFingerprint: runner.hostKeyFingerprint },
        });
      }
      try {
        await runPipeline(runner, buildModules(opts), async (step) => {
          await prisma.provisionRun.create({ data: toProvisionRunData(serverId, step) });
        });
      } finally {
        runner.close();
      }
    },
    { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } },
  );
}
