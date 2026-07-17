import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "prov@dh.test";

describe("Provision tetikleme + ilerleme", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.9", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("provizyon tetikler (202 + jobId)", async () => {
    const res = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
  });

  it("ilerleme listesi 200 döner (dizi)", async () => {
    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
