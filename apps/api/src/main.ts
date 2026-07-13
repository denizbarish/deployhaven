import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app.use(cookieParser());
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
