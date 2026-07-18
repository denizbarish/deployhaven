import { Module } from "@nestjs/common";
import { ServersController } from "./servers.controller.js";
import { ServersService } from "./servers.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ServersController],
  providers: [ServersService],
  exports: [ServersService],
})
export class ServersModule {}
