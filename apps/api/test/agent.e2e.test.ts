import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "agent@dh.test";
const otherEmail = "agent-other@dh.test";
const rotateEmail = "agent-rotate@dh.test";

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

// FIND-002: enroll-token IDOR. Başka takımdaki kullanıcı sahibin sunucusuna
// token basamamalı (404); sahip basabilmeli.
describe("Agent enroll-token IDOR (FIND-002): çapraz-kiracı 404", () => {
  let app: INestApplication;
  let ownerCookie: string;
  let otherCookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const owner = await request(app.getHttpServer()).post("/auth/register").send({ email, password: "password123" });
    ownerCookie = owner.headers["set-cookie"][0];
    const other = await request(app.getHttpServer()).post("/auth/register").send({ email: otherEmail, password: "password123" });
    otherCookie = other.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", ownerCookie)
      .send({ name: "vps", host: "10.0.0.8", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  it("başka kullanıcı enroll-token → 404", async () => {
    const res = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("sahip enroll-token → 201", async () => {
    const res = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", ownerCookie);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
  });
});

// FIND-007: enroll-token clobber. Kayıtlı (online) agent'ta rotate'siz yeniden
// basım 409; rotate:true ile yeni token verilir ve eski token artık register
// edilemez.
describe("Agent enroll-token rotate (FIND-007): clobber koruması", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email: rotateEmail, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.12", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: rotateEmail } });
    await app.close();
  });

  it("ilk basım + register, rotate'siz yeniden basım 409, rotate ile yeni token", async () => {
    // İlk basım
    const first = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", cookie);
    expect(first.status).toBe(201);
    const firstToken = first.body.token;
    expect(firstToken).toBeTruthy();

    // Agent enroll olur → status "online"
    const regRes = await request(app.getHttpServer()).post("/agent/register").send({ token: firstToken });
    expect(regRes.status).toBe(200);

    // rotate'siz yeniden basım → 409 (mevcut agent'ı sessizce ezmemeli)
    const clobber = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", cookie);
    expect(clobber.status).toBe(409);

    // rotate:true ile yeni token verilir
    const rotated = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", cookie).send({ rotate: true });
    expect(rotated.status).toBe(201);
    const newToken = rotated.body.token;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(firstToken);

    // Eski token artık register edemez (401), yeni token register edebilir (200)
    const oldReg = await request(app.getHttpServer()).post("/agent/register").send({ token: firstToken });
    expect(oldReg.status).toBe(401);

    const newReg = await request(app.getHttpServer()).post("/agent/register").send({ token: newToken });
    expect(newReg.status).toBe(200);
  });
});
