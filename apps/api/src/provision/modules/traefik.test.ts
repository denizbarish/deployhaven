import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { traefikModule } from "./traefik.js";

describe("traefik", () => {
  it("traefik container çalışıyorsa check true", async () => {
    const r = new FakeRunner();
    r.script(/docker ps .*deployhaven-traefik/, { stdout: "abc123" });
    expect(await traefikModule("ops@dh.dev").check(r)).toBe(true);
  });

  it("container yoksa check false", async () => {
    const r = new FakeRunner();
    r.script(/docker ps .*deployhaven-traefik/, { stdout: "" });
    expect(await traefikModule("ops@dh.dev").check(r)).toBe(false);
  });

  it("apply compose + config yükler, network kurar, up -d eder", async () => {
    const r = new FakeRunner();
    await traefikModule("ops@dh.dev").apply(r);
    expect(r.uploads.some((u) => u.path.includes("docker-compose.yml") && u.content.includes("traefik"))).toBe(true);
    expect(r.uploads.some((u) => u.content.includes("ops@dh.dev"))).toBe(true);
    expect(r.calls.some((c) => /docker network create deployhaven/.test(c))).toBe(true);
    expect(r.calls.some((c) => /docker compose .*up -d/.test(c))).toBe(true);
  });
});
