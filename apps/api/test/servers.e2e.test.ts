import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "srv@dh.test";

describe("Servers CRUD", () => {
  let app: INestApplication;
  let cookie: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("sunucu oluşturur, özel anahtarı yanıtta döndürmez, şifreli saklar", async () => {
    const res = await request(app.getHttpServer())
      .post("/servers")
      .set("Cookie", cookie)
      .send({ name: "vps1", host: "10.0.0.1", sshPrivateKey: "SECRET-KEY-MATERIAL" });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("SECRET-KEY-MATERIAL");
    const row = await prisma.server.findUnique({ where: { id: res.body.id } });
    expect(row?.sshKeyCipher).toBeTruthy();
    expect(row?.sshKeyCipher).not.toContain("SECRET-KEY-MATERIAL");
  });

  it("çerezsiz 401", async () => {
    const res = await request(app.getHttpServer()).get("/servers");
    expect(res.status).toBe(401);
  });
});
