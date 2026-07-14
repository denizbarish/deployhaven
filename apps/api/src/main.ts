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
  await app.listen(process.env.API_PORT ?? 4000);
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap();
}
