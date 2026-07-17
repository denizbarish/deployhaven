import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard.js";
import { ServersService } from "./servers.service.js";
import { CreateServerDto } from "./dto.js";

@Controller("servers")
@UseGuards(SessionGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post()
  create(@Req() req: Request & { userId: string }, @Body() dto: CreateServerDto) {
    return this.servers.create(req.userId, dto);
  }

  @Get()
  list(@Req() req: Request & { userId: string }) {
    return this.servers.list(req.userId);
  }
}
