import { describe, it, expect } from "vitest";
import { isTerminalRun, latestRunId, FINAL_MODULE_ID, SSE_MAX_TICKS } from "./provision.stream.js";

describe("isTerminalRun (FIND-004 SSE sonlanma)", () => {
  it("boş liste terminal değildir", () => {
    expect(isTerminalRun([])).toBe(false);
  });

  it("devam eden adımlar terminal değildir", () => {
    expect(
      isTerminalRun([
        { step: "precheck", status: "done" },
        { step: "docker", status: "done" },
      ]),
    ).toBe(false);
  });

  it("herhangi bir failed adım terminaldir", () => {
    expect(
      isTerminalRun([
        { step: "precheck", status: "done" },
        { step: "ssh-hardening", status: "failed" },
      ]),
    ).toBe(true);
  });

  it("son modül (traefik) done olduğunda terminaldir", () => {
    expect(isTerminalRun([{ step: FINAL_MODULE_ID, status: "done" }])).toBe(true);
  });

  it("son modül (traefik) skipped olduğunda terminaldir", () => {
    expect(isTerminalRun([{ step: FINAL_MODULE_ID, status: "skipped" }])).toBe(true);
  });

  it("SSE_MAX_TICKS makul bir üst sınırdır", () => {
    expect(SSE_MAX_TICKS).toBeGreaterThan(0);
  });
});

describe("latestRunId (Important #1: en son çalışmayı seçme)", () => {
  it("satır yoksa null döner", () => {
    expect(latestRunId([])).toBeNull();
  });

  it("en büyük createdAt'a sahip satırın runId'sini döner", () => {
    const rows = [
      { runId: "run_old", createdAt: new Date("2026-07-18T10:00:00Z") },
      { runId: "run_old", createdAt: new Date("2026-07-18T10:00:05Z") },
      { runId: "run_new", createdAt: new Date("2026-07-18T11:00:00Z") },
    ];
    expect(latestRunId(rows)).toBe("run_new");
  });

  it("sıralama bozuk gelse bile en son çalışmayı bulur", () => {
    const rows = [
      { runId: "run_new", createdAt: new Date("2026-07-18T11:00:00Z") },
      { runId: "run_old", createdAt: new Date("2026-07-18T10:00:00Z") },
    ];
    expect(latestRunId(rows)).toBe("run_new");
  });
});
