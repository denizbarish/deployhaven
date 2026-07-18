import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { dockerModule } from "./docker.js";

describe("docker", () => {
  it("docker kuruluysa check true", async () => {
    const r = new FakeRunner();
    r.script("docker --version", { stdout: "Docker version 27.1", code: 0 });
    expect(await dockerModule.check(r)).toBe(true);
  });

  it("docker yoksa check false", async () => {
    const r = new FakeRunner();
    r.script("docker --version", { code: 127 });
    expect(await dockerModule.check(r)).toBe(false);
  });

  it("apply repo ekler, paketleri kurar, deploy'u docker grubuna alır", async () => {
    const r = new FakeRunner();
    await dockerModule.apply(r);
    expect(r.calls.some((c) => /apt-get -y install .*docker-ce/.test(c))).toBe(true);
    expect(r.calls.some((c) => /docker-compose-plugin/.test(c))).toBe(true);
    expect(r.calls.some((c) => /usermod -aG docker deploy/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl enable --now docker/.test(c))).toBe(true);
  });
});
