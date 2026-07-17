import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { ServersModule } from "./servers/servers.module.js";
import { ProvisionModule } from "./provision/provision.module.js";

@Module({
  imports: [AuthModule, ServersModule, ProvisionModule],
  controllers: [HealthController],
})
export class AppModule {}
