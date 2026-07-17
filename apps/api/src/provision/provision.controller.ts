import { Controller, Get, Inject, Param, Post, HttpCode, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SessionGuard } from "../auth/session.guard.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

@Controller("servers/:id/provision")
@UseGuards(SessionGuard)
export class ProvisionController {
  constructor(@Inject(PROVISION_QUEUE) private readonly queue: Queue) {}

  @Post()
  @HttpCode(202)
  async trigger(@Param("id") id: string) {
    const job = await this.queue.add("provision", { serverId: id });
    return { jobId: job.id };
  }

  @Get()
  async progress(@Param("id") id: string) {
    return prisma.provisionRun.findMany({
      where: { serverId: id },
      orderBy: { createdAt: "asc" },
    });
  }
}
