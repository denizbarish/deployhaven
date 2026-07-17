import { Controller, Get, Inject, Param, Post, HttpCode, UseGuards, Sse, MessageEvent, Req } from "@nestjs/common";
import type { Request } from "express";
import { Queue } from "bullmq";
import { prisma } from "@deployhaven/db";
import { interval, switchMap, from, map, Observable } from "rxjs";
import { SessionGuard } from "../auth/session.guard.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";
import { ServersService } from "../servers/servers.service.js";

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
      switchMap(() =>
        from(
          prisma.provisionRun.findMany({
            where: { serverId: id },
            orderBy: { createdAt: "asc" },
          }),
        ),
      ),
      map((rows): MessageEvent => ({ data: rows })),
    );
  }
}
