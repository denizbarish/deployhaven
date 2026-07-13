import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

const email = "reg@dh.test";

describe("POST /auth/register", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("kullanıcı + team + OWNER üyelik oluşturur ve çerez verir", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    expect(res.body.teamId).toBeTruthy();
    expect(res.headers["set-cookie"][0]).toContain("dh_session");

    const membership = await prisma.membership.findFirst({
      where: { userId: res.body.userId },
    });
    expect(membership?.role).toBe("OWNER");
  });

  it("aynı e-posta ikinci kez 409 döner", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123" });
    expect(res.status).toBe(409);
  });
});
