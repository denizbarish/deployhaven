import { describe, it, expect } from "vitest";
import { toProvisionRunData } from "./provision.processor.js";
import type { StepResult } from "./module.js";

describe("toProvisionRunData (FIND-008 ProvisionRun.error persisti)", () => {
  const serverId = "srv_123";

  it("done adımında error null olur", () => {
    const step: StepResult = { id: "docker", status: "done" };
    expect(toProvisionRunData(serverId, step)).toEqual({
      serverId,
      step: "docker",
      status: "done",
      error: null,
    });
  });

  it("skipped adımında error null olur", () => {
    const step: StepResult = { id: "precheck", status: "skipped" };
    expect(toProvisionRunData(serverId, step).error).toBeNull();
  });

  it("failed adımında hata mesajı persist edilir", () => {
    const step: StepResult = { id: "ssh-hardening", status: "failed", error: "lockout önlendi" };
    expect(toProvisionRunData(serverId, step)).toEqual({
      serverId,
      step: "ssh-hardening",
      status: "failed",
      error: "lockout önlendi",
    });
  });

  it("failed ama error tanımsızsa null'a düşer", () => {
    const step: StepResult = { id: "docker", status: "failed" };
    expect(toProvisionRunData(serverId, step).error).toBeNull();
  });
});
