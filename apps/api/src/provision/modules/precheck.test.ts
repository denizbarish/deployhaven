import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { precheckModule } from "./precheck.js";

describe("precheck", () => {
  it("ubuntu 24.04 + sudo varsa apply hatasız geçer", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=ubuntu\nVERSION_ID="24.04"' });
    r.script("sudo -n true", { code: 0 });
    await expect(precheckModule.apply(r)).resolves.toBeUndefined();
  });

  it("desteklenmeyen OS'te hata fırlatır", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=centos\nVERSION_ID="9"' });
    await expect(precheckModule.apply(r)).rejects.toThrow(/desteklenmeyen|unsupported/i);
  });

  it("sudo yoksa hata fırlatır", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=ubuntu\nVERSION_ID="22.04"' });
    r.script("sudo -n true", { code: 1, stderr: "a password is required" });
    await expect(precheckModule.apply(r)).rejects.toThrow(/sudo/i);
  });

  it("check daima false döner", async () => {
    expect(await precheckModule.check(new FakeRunner())).toBe(false);
  });
});
