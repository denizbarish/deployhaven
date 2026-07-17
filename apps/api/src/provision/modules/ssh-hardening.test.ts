import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { assertValidPublicKey, sshHardeningModule } from "./ssh-hardening.js";

const KEY = "ssh-ed25519 AAAAC3Nz deniz@dh";

describe("ssh-hardening", () => {
  it("deploy kullanıcısı + hardening drop-in varsa check true", async () => {
    const r = new FakeRunner();
    r.script("id deploy", { code: 0 });
    r.script(/grep .*PermitRootLogin no/, { code: 0 });
    r.script(/grep .*PasswordAuthentication no/, { code: 0 });
    expect(await sshHardeningModule(KEY).check(r)).toBe(true);
  });

  it("deploy kullanıcısı yoksa check false", async () => {
    const r = new FakeRunner();
    r.script("id deploy", { code: 1 });
    expect(await sshHardeningModule(KEY).check(r)).toBe(false);
  });

  it("apply kullanıcı oluşturur, anahtar yükler, sshd doğrular ve reload eder", async () => {
    const r = new FakeRunner();
    await sshHardeningModule(KEY).apply(r);
    expect(r.calls.some((c) => /useradd .*deploy/.test(c))).toBe(true);
    expect(r.uploads.some((u) => u.path.includes("authorized_keys") && u.content.includes(KEY))).toBe(true);
    expect(r.uploads.some((u) => u.path.includes("sshd_config.d") && /PermitRootLogin no/.test(u.content))).toBe(true);
    expect(r.calls.some((c) => /sshd -t/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl reload ssh/.test(c))).toBe(true);
  });
});

describe("assertValidPublicKey (FIND-006 içerik enjeksiyonu)", () => {
  it("geçerli tek satırlık anahtarları kabul eder", () => {
    expect(() => assertValidPublicKey(KEY)).not.toThrow();
    expect(() => assertValidPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB")).not.toThrow();
    expect(() =>
      assertValidPublicKey("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY= x@y"),
    ).not.toThrow();
  });

  it("boş anahtarı reddeder", () => {
    expect(() => assertValidPublicKey("")).toThrow();
    expect(() => assertValidPublicKey("   ")).toThrow();
  });

  it("gömülü newline içeren değeri reddeder (çoklu anahtar enjeksiyonu)", () => {
    expect(() => assertValidPublicKey(`${KEY}\nssh-rsa AAAAsecondkey attacker`)).toThrow(
      /satır sonu/,
    );
  });

  it("command= gibi opsiyon öneki içeren değeri reddeder", () => {
    expect(() =>
      assertValidPublicKey('command="rm -rf /" ssh-ed25519 AAAAC3Nz deploy'),
    ).toThrow(/formatına uymuyor/);
  });
});

describe("sshHardeningModule.apply sırası (FIND-005 fail-closed)", () => {
  it("authorized_keys + doğrulama, PasswordAuthentication no drop-in'inden ÖNCE gelir", async () => {
    const r = new FakeRunner();
    await sshHardeningModule(KEY).apply(r);

    const authKeysUpload = r.uploads.find((u) => u.path.endsWith("authorized_keys"));
    const dropinUpload = r.uploads.find((u) => u.content.includes("PasswordAuthentication no"));
    expect(authKeysUpload).toBeDefined();
    expect(dropinUpload).toBeDefined();
    // authorized_keys, drop-in'den önce yüklenmeli.
    expect(r.uploads.indexOf(authKeysUpload!)).toBeLessThan(r.uploads.indexOf(dropinUpload!));

    // Fail-closed doğrulama exec'i (test -s ...authorized_keys) çalışmış olmalı.
    const verifyIdx = r.calls.findIndex(
      (c) => c.includes("test -s") && c.includes("authorized_keys"),
    );
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
  });

  it("anahtar doğrulaması başarısızsa (test -s -> code 1) throw eder, drop-in yazılmaz", async () => {
    const r = new FakeRunner();
    r.script(/test -s .*authorized_keys/, { code: 1 });

    await expect(sshHardeningModule(KEY).apply(r)).rejects.toThrow(/lockout önlendi/);
    expect(r.uploads.some((u) => u.content.includes("PasswordAuthentication no"))).toBe(false);
  });

  it("sertleştirme öncesi sshd -t başarısızsa throw eder, drop-in yazılmaz", async () => {
    const r = new FakeRunner();
    r.script("sshd -t", { code: 1, stderr: "bad config" });

    await expect(sshHardeningModule(KEY).apply(r)).rejects.toThrow(/sshd config geçersiz/);
    expect(r.uploads.some((u) => u.content.includes("PasswordAuthentication no"))).toBe(false);
  });

  it("geçersiz publicKey ile apply hiçbir dosya yüklemeden throw eder", async () => {
    const r = new FakeRunner();
    await expect(sshHardeningModule('command="x" bogus').apply(r)).rejects.toThrow();
    expect(r.uploads).toHaveLength(0);
  });
});
