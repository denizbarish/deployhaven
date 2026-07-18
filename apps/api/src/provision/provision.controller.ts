import { Controller, Get, Inject, Param, Post, HttpCode, Query, UseGuards, Sse, MessageEvent, Req } from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { prisma } from "@deployhaven/db";
import { interval, switchMap, from, map, takeWhile, take, Observable } from "rxjs";
import { SessionGuard } from "../auth/session.guard.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";
import { ServersService } from "../servers/servers.service.js";
import { isTerminalRun, SSE_MAX_TICKS } from "./provision.stream.js";

type ProvisionRunRow = { step: string; status: string };

@Controller("servers/:id/provision")
@UseGuards(SessionGuard)
export class ProvisionController {
  constructor(
    @Inject(PROVISION_QUEUE) private readonly queue: Queue,
    private readonly servers: ServersService,
  ) {}

  @Post()
  @HttpCode(202)
  async trigger(@Req() req: Request & { userId: string }, @Param("id") id: string) {
    await this.servers.assertOwned(req.userId, id);
    // Important #1: bu çalışmayı gruplayan runId'yi tetikleyicide üretip job'a taşırız.
    // Worker aynı runId ile her ProvisionRun satırını yazar; ilerleme/SSE bunu filtreler.
    const runId = randomUUID();
    const job = await this.queue.add("provision", { serverId: id, runId });
    return { jobId: job.id, runId };
  }

  @Get()
  async progress(
    @Req() req: Request & { userId: string },
    @Param("id") id: string,
    @Query("runId") runIdParam?: string,
  ) {
    await this.servers.assertOwned(req.userId, id);
    const runId = await this.resolveRunId(id, runIdParam);
    if (!runId) return [];
    return this.rowsForRun(id, runId);
  }

  @Sse("stream")
  async stream(
    @Req() req: Request & { userId: string },
    @Param("id") id: string,
    @Query("runId") runIdParam?: string,
  ): Promise<Observable<MessageEvent>> {
    await this.servers.assertOwned(req.userId, id);
    // Important #1: akış açıldığında hedef runId'yi bir kez sabitle (varsayılan: en son
    // çalışma). Böylece akış SIRASINDA yeni bir provizyon başlasa bile bu akış kendi
    // çalışmasını izlemeye devam eder ve eski/yeni satırlar birbirine karışmaz.
    const runId = await this.resolveRunId(id, runIdParam);
    return interval(2000).pipe(
      // FIND-004: sınırsız polling'i sınırla (maksimum süre / güvenlik ağı).
      take(SSE_MAX_TICKS),
      switchMap(() => from(runId ? this.rowsForRun(id, runId) : Promise.resolve([]))),
      // Important #1: terminal tespiti YALNIZCA mevcut çalışmanın satırlarına bakar,
      // geçmiş çalışmaların terminal satırlarına değil. Terminale ulaşınca son emit'i
      // de gönderip stream'i sonlandır (inclusive).
      takeWhile((rows: ProvisionRunRow[]) => !isTerminalRun(rows), true),
      map((rows): MessageEvent => ({ data: rows })),
    );
  }

  /**
   * Hedef runId'yi çözer: açıkça verilmişse onu, yoksa sunucunun EN SON çalışmasını
   * (en büyük createdAt'a sahip satırın runId'si). Hiç satır yoksa null.
   */
  private async resolveRunId(serverId: string, runIdParam?: string): Promise<string | null> {
    if (runIdParam) return runIdParam;
    // En son çalışmayı DB'de deterministik sırayla seç: createdAt desc, id desc
    // (aynı milisaniyede createdAt çakışırsa id ikincil sıralama ile kararlı sonuç
    // verir). take:1 + serverId,runId indeksi ile tüm satırları JS'e çekmeye gerek yok.
    const latest = await prisma.provisionRun.findFirst({
      where: { serverId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { runId: true },
    });
    return latest?.runId ?? null;
  }

  /** Verilen çalışmanın satırlarını sıralı döndürür. */
  private rowsForRun(serverId: string, runId: string) {
    return prisma.provisionRun.findMany({
      where: { serverId, runId },
      orderBy: { createdAt: "asc" },
    });
  }
}
