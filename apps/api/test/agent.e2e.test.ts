import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "agent@dh.test";

describe("Agent enrollment", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.7", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("enroll token üretir, agent kaydolur, heartbeat 204", async () => {
    const tok = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", cookie);
    expect(tok.status).toBe(201);
    const token = tok.body.token;
    expect(token).toBeTruthy();

    const reg = await request(app.getHttpServer()).post("/agent/register").send({ token });
    expect(reg.status).toBe(200);
    expect(reg.body.agentId).toBeTruthy();

    const hb = await request(app.getHttpServer()).post("/agent/heartbeat").set("x-agent-token", token);
    expect(hb.status).toBe(204);
  });

  it("geçersiz token register 401", async () => {
    const reg = await request(app.getHttpServer()).post("/agent/register").send({ token: "gecersiz" });
    expect(reg.status).toBe(401);
  });
});
