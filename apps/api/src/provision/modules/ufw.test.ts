import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { ufwModule } from "./ufw.js";

describe("ufw", () => {
  it("ufw aktifse check true", async () => {
    const r = new FakeRunner();
    r.script("ufw status", { stdout: "Status: active" });
    expect(await ufwModule([80, 443]).check(r)).toBe(true);
  });

  it("ufw pasifse check false", async () => {
    const r = new FakeRunner();
    r.script("ufw status", { stdout: "Status: inactive" });
    expect(await ufwModule([80, 443]).check(r)).toBe(false);
  });

  it("apply default deny + OpenSSH + portlar + enable", async () => {
    const r = new FakeRunner();
    await ufwModule([80, 443]).apply(r);
    expect(r.calls.some((c) => /ufw default deny incoming/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow OpenSSH/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow 80/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow 443/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw --force enable/.test(c))).toBe(true);
  });
});
