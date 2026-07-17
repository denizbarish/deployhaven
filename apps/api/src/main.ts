import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.PANEL_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  if (process.env.NODE_ENV !== "test") {
    const { startProvisionWorker } = await import("./provision/provision.processor.js");
    const { ServersService } = await import("./servers/servers.service.js");
    const svc = app.get(ServersService);
    startProvisionWorker((serverId) => svc.getSshCredentials(serverId), {
      publicKey: process.env.PROVISION_PUBLIC_KEY ?? "",
      acmeEmail: process.env.ACME_EMAIL ?? "ops@example.com",
    });
  }
  await app.listen(process.env.API_PORT ?? 4000);
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap();
}
