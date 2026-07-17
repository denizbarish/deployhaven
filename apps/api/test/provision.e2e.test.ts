import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "prov@dh.test";

const otherEmail = "prov-other@dh.test";

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

// FIND-002 / FIND-004: Başka takımdaki kullanıcı sunucu-kapsamlı provision
// endpoint'lerinde 404 almalı (IDOR koruması); sahip erişebilmeli.
describe("Provision IDOR (FIND-002/004): çapraz-kiracı 404", () => {
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
      .send({ name: "vps", host: "10.0.0.11", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  it("başka kullanıcı trigger POST → 404", async () => {
    const res = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("başka kullanıcı progress GET → 404", async () => {
    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision`).set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("başka kullanıcı stream SSE → 404", async () => {
    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision/stream`).set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("sahip trigger POST → 202", async () => {
    const res = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", ownerCookie);
    expect(res.status).toBe(202);
  });

  it("sahip progress GET → 200", async () => {
    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision`).set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
