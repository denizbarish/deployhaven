import {
  Body, Controller, Headers, HttpCode, Param, Post, UseGuards, UnauthorizedException,
} from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { AgentService } from "./agent.service.js";

@Controller()
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Post("servers/:id/agent/enroll-token")
  @UseGuards(SessionGuard)
  @HttpCode(201)
  async token(@Param("id") id: string) {
    return { token: await this.agents.issueToken(id) };
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
