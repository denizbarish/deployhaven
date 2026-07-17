import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { ServersModule } from "./servers/servers.module.js";

@Module({
  imports: [AuthModule, ServersModule],
  controllers: [HealthController],
})
export class AppModule {}
