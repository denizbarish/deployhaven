import { describe, it, expect } from "vitest";
import { toProvisionRunData, safeConnectError } from "./provision.processor.js";
import type { StepResult } from "./module.js";

describe("toProvisionRunData (FIND-008 ProvisionRun.error persisti)", () => {
  const serverId = "srv_123";
  const runId = "run_abc";

  it("done adımında error null olur ve runId taşınır", () => {
    const step: StepResult = { id: "docker", status: "done" };
    expect(toProvisionRunData(serverId, runId, step)).toEqual({
      serverId,
      runId,
      step: "docker",
      status: "done",
      error: null,
    });
  });

  it("skipped adımında error null olur", () => {
    const step: StepResult = { id: "precheck", status: "skipped" };
    expect(toProvisionRunData(serverId, runId, step).error).toBeNull();
  });

  it("failed adımında hata mesajı persist edilir", () => {
    const step: StepResult = { id: "ssh-hardening", status: "failed", error: "lockout önlendi" };
    expect(toProvisionRunData(serverId, runId, step)).toEqual({
      serverId,
      runId,
      step: "ssh-hardening",
      status: "failed",
      error: "lockout önlendi",
    });
  });

  it("failed ama error tanımsızsa null'a düşer", () => {
    const step: StepResult = { id: "docker", status: "failed" };
    expect(toProvisionRunData(serverId, runId, step).error).toBeNull();
  });
});

describe("safeConnectError (Important #2: sır sızdırmadan güvenli hata mesajı)", () => {
  it("Error.message'ın ilk satırını döndürür", () => {
    expect(safeConnectError(new Error("host down\nstack line 1\nstack line 2"))).toBe("host down");
  });

  it("Error olmayan değerleri string'e çevirir", () => {
    expect(safeConnectError("ETIMEDOUT")).toBe("ETIMEDOUT");
  });

  it("boş mesajda anlamlı bir yedeğe düşer", () => {
    expect(safeConnectError(new Error(""))).toBe("bağlantı kurulamadı");
  });

  it("çok uzun mesajı 300 karaktere kırpar (sır/anahtar sızıntısı yüzeyini sınırlar)", () => {
    const long = "x".repeat(1000);
    expect(safeConnectError(new Error(long)).length).toBe(300);
  });
});
