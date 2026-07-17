import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { systemUpdateModule } from "./system-update.js";

describe("system-update", () => {
  it("temel paketler kuruluysa check true", async () => {
    const r = new FakeRunner();
    r.script(/dpkg -s/, { code: 0 });
    expect(await systemUpdateModule.check(r)).toBe(true);
  });

  it("paket eksikse check false", async () => {
    const r = new FakeRunner();
    r.script(/dpkg -s/, { code: 1 });
    expect(await systemUpdateModule.check(r)).toBe(false);
  });

  it("apply apt update + upgrade + kurulum çalıştırır (sudo)", async () => {
    const r = new FakeRunner();
    await systemUpdateModule.apply(r);
    expect(r.calls.some((c) => /sudo apt-get update/.test(c))).toBe(true);
    expect(r.calls.some((c) => /apt-get -y upgrade/.test(c))).toBe(true);
    expect(r.calls.some((c) => /apt-get -y install .*ca-certificates/.test(c))).toBe(true);
  });
});
