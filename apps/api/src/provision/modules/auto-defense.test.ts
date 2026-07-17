import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { autoDefenseModule } from "./auto-defense.js";

describe("auto-defense", () => {
  it("iki servis de enabled ise check true", async () => {
    const r = new FakeRunner();
    r.script(/is-enabled fail2ban/, { stdout: "enabled", code: 0 });
    r.script(/is-enabled unattended-upgrades/, { stdout: "enabled", code: 0 });
    expect(await autoDefenseModule.check(r)).toBe(true);
  });

  it("biri eksikse check false", async () => {
    const r = new FakeRunner();
    r.script(/is-enabled fail2ban/, { stdout: "enabled", code: 0 });
    r.script(/is-enabled unattended-upgrades/, { code: 1 });
    expect(await autoDefenseModule.check(r)).toBe(false);
  });

  it("apply kurar ve enable eder", async () => {
    const r = new FakeRunner();
    await autoDefenseModule.apply(r);
    expect(r.calls.some((c) => /apt-get -y install .*fail2ban/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl enable --now fail2ban/.test(c))).toBe(true);
    expect(r.calls.some((c) => /dpkg-reconfigure -f noninteractive unattended-upgrades/.test(c))).toBe(true);
  });
});
