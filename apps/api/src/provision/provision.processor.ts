import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SshRunner } from "./ssh-runner.js";
import { runPipeline, type StepResult } from "./module.js";
import { buildModules } from "./provision.pipeline.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

/**
 * Bir StepResult'ı ProvisionRun satırına eşler (saf, test edilebilir).
 * FIND-008: hata mesajı yalnızca `failed` durumunda kalıcı olur; aksi halde null.
 * Important #1: her satır ilgili job'ın `runId`'sini taşır; ilerleme/SSE bu runId'ye göre gruplanır.
 */
export function toProvisionRunData(serverId: string, runId: string, step: StepResult) {
  return {
    serverId,
    runId,
    step: step.id,
    status: step.status,
    error: step.status === "failed" ? step.error ?? null : null,
  };
}

/**
 * Bağlantı öncesi (pre-pipeline) hatalarını güvenli, kısa bir mesaja indirger.
 * Important #2: özel anahtar veya tam sır metni asla hataya sızmamalı; yalnızca
 * Error.message'ın ilk satırı ve makul bir uzunluk sınırı kalıcı olur.
 */
export function safeConnectError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const cleaned = firstLine.length > 0 ? firstLine : "bağlantı kurulamadı";
  return cleaned.slice(0, 300);
}

export function startProvisionWorker(getCreds: (serverId: string) => Promise<{
  host: string; user: string; port: number; privateKey: string; hostKeyFingerprint: string | null;
}>, opts: { publicKey: string; acmeEmail: string }) {
  return new Worker(
    PROVISION_QUEUE,
    async (job) => {
      const { serverId } = job.data as { serverId: string; runId?: string };
      // Important #1: bu job'a ait çalışmayı gruplayan benzersiz runId. Tetikleyici
      // job.data.runId gönderir; yoksa job.id (BullMQ'da benzersiz) yedeğe düşer.
      const runId = (job.data as { runId?: string }).runId ?? job.id ?? randomUUID();

      // Important #2: kimlik bilgisi yükleme + bağlantı + host-key pinleme aşaması
      // pipeline'dan önce gelir. Burada bir hata olursa hiçbir satır yazılmaz ve
      // ilerleme/SSE SSE_MAX_TICKS'e kadar asılı kalırdı. Bu aşamayı try/catch ile
      // sararak başarısızlıkta terminal bir "connect/failed" satırı kalıcı kılıyoruz.
      let runner: Awaited<ReturnType<typeof SshRunner.connect>>;
      try {
        const creds = await getCreds(serverId);
        runner = await SshRunner.connect({
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
      } catch (err) {
        await prisma.provisionRun.create({
          data: toProvisionRunData(serverId, runId, {
            id: "connect",
            status: "failed",
            error: safeConnectError(err),
          }),
        });
        throw err;
      }

      try {
        await runPipeline(runner, buildModules(opts), async (step) => {
          await prisma.provisionRun.create({ data: toProvisionRunData(serverId, runId, step) });
        });
      } finally {
        runner.close();
      }
    },
    { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } },
  );
}
