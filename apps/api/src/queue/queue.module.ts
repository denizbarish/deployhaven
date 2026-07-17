import { Module } from "@nestjs/common";
import { Queue } from "bullmq";

export const PROVISION_QUEUE = "provision";

export const provisionQueueProvider = {
  provide: PROVISION_QUEUE,
  useFactory: () =>
    new Queue(PROVISION_QUEUE, {
      connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    }),
};

@Module({
  providers: [provisionQueueProvider],
  exports: [provisionQueueProvider],
})
export class QueueModule {}
