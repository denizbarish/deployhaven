import {
  Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards, UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard.js";
import { AgentService } from "./agent.service.js";
import { ServersService } from "../servers/servers.service.js";

@Controller()
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly servers: ServersService,
  ) {}

  @Post("servers/:id/agent/enroll-token")
  @UseGuards(SessionGuard)
  @HttpCode(201)
  async token(
    @Req() req: Request & { userId: string },
    @Param("id") id: string,
    @Body() body?: { rotate?: boolean },
  ) {
    await this.servers.assertOwned(req.userId, id);
    return { token: await this.agents.issueToken(id, body?.rotate === true) };
  }

  @Post("agent/register")
  @HttpCode(200)
  async register(@Body() body: { token?: string }) {
    if (!body?.token) throw new UnauthorizedException();
    return { agentId: await this.agents.register(body.token) };
  }

  @Post("agent/heartbeat")
  @HttpCode(204)
  async heartbeat(@Headers("x-agent-token") token?: string) {
    if (!token) throw new UnauthorizedException();
    await this.agents.heartbeat(token);
  }
}
