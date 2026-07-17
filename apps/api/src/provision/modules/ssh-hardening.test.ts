import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { sshHardeningModule } from "./ssh-hardening.js";

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
