import { Controller, Get, Inject, Param, Post, HttpCode, UseGuards, Sse, MessageEvent, Req } from "@nestjs/common";
import type { Request } from "express";
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
    const job = await this.queue.add("provision", { serverId: id });
    return { jobId: job.id };
  }

  @Get()
  async progress(@Req() req: Request & { userId: string }, @Param("id") id: string) {
    await this.servers.assertOwned(req.userId, id);
    return prisma.provisionRun.findMany({
      where: { serverId: id },
      orderBy: { createdAt: "asc" },
    });
  }

  @Sse("stream")
  async stream(
    @Req() req: Request & { userId: string },
    @Param("id") id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.servers.assertOwned(req.userId, id);
    return interval(2000).pipe(
      // FIND-004: sınırsız polling'i sınırla (maksimum süre / güvenlik ağı).
      take(SSE_MAX_TICKS),
      switchMap(() =>
        from(
          prisma.provisionRun.findMany({
            where: { serverId: id },
            orderBy: { createdAt: "asc" },
          }),
        ),
      ),
      // Terminal duruma (failed adım veya son modül traefik done/skipped) ulaşınca
      // son emit'i de gönderip stream'i sonlandır (inclusive).
      takeWhile((rows: ProvisionRunRow[]) => !isTerminalRun(rows), true),
      map((rows): MessageEvent => ({ data: rows })),
    );
  }
}
