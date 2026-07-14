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

describe("POST /auth/login", () => {
  let app: INestApplication;
  const loginEmail = "login@dh.test";
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: loginEmail, password: "password123" });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: loginEmail } });
    await app.close();
  });

  it("doğru bilgiyle 200 ve çerez", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: loginEmail, password: "password123" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"][0]).toContain("dh_session");
  });

  it("yanlış parolayla 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: loginEmail, password: "wrongpass1" });
    expect(res.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  let app: INestApplication;
  const meEmail = "me@dh.test";
  let cookie: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: meEmail, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: meEmail } });
    await app.close();
  });

  it("çerezsiz 401", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("çerezle 200 ve kullanıcı bilgisi", async () => {
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(meEmail);
  });
});

// FIND-002: çerez değeri Session.id (cuid) DEĞİL, yüksek entropili rastgele
// token olmalı; sahte/rastgele çerez 401 dönmeli.
describe("Oturum çerezi CSPRNG token (FIND-002)", () => {
  let app: INestApplication;
  const secEmail = "sec@dh.test";
  let cookie: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: secEmail, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: secEmail } });
    await app.close();
  });

  it("çerez değeri hiçbir Session.id ile eşleşmez", async () => {
    const user = await prisma.user.findUnique({ where: { email: secEmail } });
    const sessions = await prisma.session.findMany({
      where: { userId: user!.id },
    });
    expect(sessions.length).toBeGreaterThan(0);

    const match = /dh_session=([^;]+)/.exec(cookie);
    const tokenValue = decodeURIComponent(match![1]);
    // Token uzun ve rastgele olmalı, cuid değil.
    expect(tokenValue.length).toBeGreaterThan(30);
    for (const s of sessions) {
      expect(tokenValue).not.toBe(s.id);
    }
  });

  it("sahte/rastgele çerez 401 döner", async () => {
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", "dh_session=forged-random-token-abc123");
    expect(res.status).toBe(401);
  });
});

// FIND-001: logout oturumu iptal eder; aynı çerezle sonraki istek 401 olur.
describe("POST /auth/logout (FIND-001)", () => {
  let app: INestApplication;
  const outEmail = "logout@dh.test";
  let cookie: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: outEmail, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: outEmail } });
    await app.close();
  });

  it("çerezsiz logout 401", async () => {
    const res = await request(app.getHttpServer()).post("/auth/logout");
    expect(res.status).toBe(401);
  });

  it("geçerli çerezle logout başarılı ve oturum artık geçersiz", async () => {
    const before = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie);
    expect(before.status).toBe(200);

    const out = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie);
    expect(out.status).toBe(204);

    const after = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie);
    expect(after.status).toBe(401);
  });
});
