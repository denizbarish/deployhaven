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

  it("ardışık iki tetikleme farklı runId üretir (Important #1)", async () => {
    const first = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", cookie);
    const second = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(first.body.runId).toBeTruthy();
    expect(second.body.runId).toBeTruthy();
    expect(first.body.runId).not.toBe(second.body.runId);
  });
});

// Important #1: ilerleme yalnızca EN SON çalışmanın satırlarını döndürmeli; taze bir
// yeniden-provizyon önceki çalışmanın satırlarını içermemeli. Worker olmadan satırları
// doğrudan yazıp controller'ın runId gruplamasını doğruluyoruz.
describe("Provision runId gruplaması (Important #1)", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  const groupEmail = "prov-group@dh.test";
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email: groupEmail, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.21", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: groupEmail } });
    await app.close();
  });

  it("ilerleme yalnızca en son çalışmanın satırlarını döndürür", async () => {
    // 1. çalışma: terminal (traefik done) geçmiş satırlar
    await prisma.provisionRun.createMany({
      data: [
        { serverId, runId: "run_one", step: "precheck", status: "done" },
        { serverId, runId: "run_one", step: "traefik", status: "done" },
      ],
    });
    // küçük bir gecikme: 2. çalışma satırları daha yeni createdAt taşısın
    await new Promise((r) => setTimeout(r, 15));
    // 2. çalışma: taze, henüz devam ediyor
    await prisma.provisionRun.createMany({
      data: [
        { serverId, runId: "run_two", step: "precheck", status: "done" },
        { serverId, runId: "run_two", step: "docker", status: "done" },
      ],
    });

    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const runIds = new Set(res.body.map((r: { runId: string }) => r.runId));
    // yalnızca en son çalışma (run_two); önceki çalışma (run_one) dahil DEĞİL
    expect(runIds.has("run_two")).toBe(true);
    expect(runIds.has("run_one")).toBe(false);
    expect(res.body).toHaveLength(2);
  });

  it("?runId= ile belirli bir çalışma hedeflenebilir", async () => {
    const res = await request(app.getHttpServer())
      .get(`/servers/${serverId}/provision`)
      .query({ runId: "run_one" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const runIds = new Set(res.body.map((r: { runId: string }) => r.runId));
    expect(runIds.has("run_one")).toBe(true);
    expect(runIds.has("run_two")).toBe(false);
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
