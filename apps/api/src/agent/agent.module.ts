import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({ imports: [AuthModule], controllers: [AgentController], providers: [AgentService] })
export class AgentModule {}
