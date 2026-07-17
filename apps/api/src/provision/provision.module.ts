import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ProvisionController } from "./provision.controller.js";

@Module({
  imports: [QueueModule, AuthModule],
  controllers: [ProvisionController],
})
export class ProvisionModule {}
