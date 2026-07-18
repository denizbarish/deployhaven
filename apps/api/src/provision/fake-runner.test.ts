import { describe, it, expect } from "vitest";
import { FakeRunner } from "./fake-runner.js";

describe("FakeRunner", () => {
  it("çağrılan komutları kaydeder ve varsayılan 0 döner", async () => {
    const r = new FakeRunner();
    const res = await r.exec("whoami");
    expect(res.code).toBe(0);
    expect(r.calls).toContain("whoami");
  });

  it("script edilen desene göre yanıt döner", async () => {
    const r = new FakeRunner();
    r.script(/docker --version/, { stdout: "Docker version 27", code: 0 });
    const res = await r.exec("docker --version");
    expect(res.stdout).toContain("Docker version");
  });

  it("sudo bayrağını komut önekine yansıtır", async () => {
    const r = new FakeRunner();
    await r.exec("apt-get update", { sudo: true });
    expect(r.calls.some((c) => c.startsWith("sudo "))).toBe(true);
  });

  it("uploadFile yüklemeleri kaydeder", async () => {
    const r = new FakeRunner();
    await r.uploadFile("hello", "/tmp/x");
    expect(r.uploads).toEqual([{ path: "/tmp/x", content: "hello" }]);
  });
});
