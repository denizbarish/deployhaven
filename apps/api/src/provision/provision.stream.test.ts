import { describe, it, expect } from "vitest";
import { isTerminalRun, FINAL_MODULE_ID, SSE_MAX_TICKS } from "./provision.stream.js";

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
