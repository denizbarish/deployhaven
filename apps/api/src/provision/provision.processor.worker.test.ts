import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Queue, type Worker } from "bullmq";
import { prisma } from "@deployhaven/db";
import { startProvisionWorker } from "./provision.processor.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

/**
 * Important #2: bağlantı öncesi (getCreds / SshRunner.connect / host-key pin) bir
 * hata fırlatırsa, hiçbir satır yazılmadığı için ilerleme/SSE SSE_MAX_TICKS'e kadar
 * asılı kalırdı. Bu test, gerçek bir SSH sunucusu olmadan getCreds'i fırlatarak
 * worker'ın terminal bir `connect/failed` satırı kalıcı kıldığını doğrular.
 */
describe("startProvisionWorker connect-phase failure (Important #2)", () => {
  const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
  let queue: Queue;
  let worker: Worker;
  let teamId: string;
  let serverId: string;

  beforeAll(async () => {
    const team = await prisma.team.create({ data: { name: "worker-test-team" } });
    teamId = team.id;
    const server = await prisma.server.create({
      data: { name: "wt", host: "203.0.113.1", teamId },
    });
    serverId = server.id;

    queue = new Queue(PROVISION_QUEUE, { connection });
    // getCreds fırlatır: bağlantı öncesi başarısızlığı simüle eder.
    worker = startProvisionWorker(
      async () => {
        throw new Error("host down: ECONNREFUSED\nprivate key would leak here");
      },
      { publicKey: "ssh-ed25519 AAAA test", acmeEmail: "a@b.test" },
    );
  });

  afterAll(async () => {
    await worker.close();
    await queue.close();
    await prisma.provisionRun.deleteMany({ where: { serverId } });
    await prisma.team.delete({ where: { id: teamId } });
  });

  it("bağlantı hatasında terminal connect/failed satırı yazar, sırrı sızdırmaz", async () => {
    const runId = randomUUID();
    await queue.add("provision", { serverId, runId });

    // Worker'ın job'ı işleyip satırı yazması için kısa poll.
    let rows: Array<{ step: string; status: string; error: string | null; runId: string }> = [];
    for (let i = 0; i < 40; i++) {
      rows = await prisma.provisionRun.findMany({ where: { serverId, runId } });
      if (rows.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(rows).toHaveLength(1);
    expect(rows[0].step).toBe("connect");
    expect(rows[0].status).toBe("failed");
    expect(rows[0].runId).toBe(runId);
    // yalnızca ilk satır (300 char sınırı); özel anahtar metni sızmamalı.
    expect(rows[0].error).toBe("host down: ECONNREFUSED");
    expect(rows[0].error).not.toContain("private key");
  });
});
