import { Worker } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SshRunner } from "./ssh-runner.js";
import { runPipeline } from "./module.js";
import { buildModules } from "./provision.pipeline.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

export function startProvisionWorker(getCreds: (serverId: string) => Promise<{
  host: string; user: string; port: number; privateKey: string;
}>, opts: { publicKey: string; acmeEmail: string }) {
  return new Worker(
    PROVISION_QUEUE,
    async (job) => {
      const { serverId } = job.data as { serverId: string };
      const creds = await getCreds(serverId);
      const runner = await SshRunner.connect({
        host: creds.host, port: creds.port, username: creds.user, privateKey: creds.privateKey,
      });
      try {
        await runPipeline(runner, buildModules(opts), async (step) => {
          await prisma.provisionRun.create({
            data: { serverId, step: step.id, status: step.status },
          });
        });
      } finally {
        runner.close();
      }
    },
    { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } },
  );
}
