import { describe, it, expect } from "vitest";
import { FakeRunner } from "./fake-runner.js";
import { runPipeline, type ProvisionModule } from "./module.js";

const mod = (
  id: string,
  checked: boolean,
  applyFn?: () => Promise<void>,
): ProvisionModule => ({
  id,
  label: id,
  check: async () => checked,
  apply: applyFn ?? (async () => {}),
});

describe("runPipeline", () => {
  it("check true ise apply atlanır (skipped)", async () => {
    let applied = false;
    const m = mod("a", true, async () => {
      applied = true;
    });
    const res = await runPipeline(new FakeRunner(), [m]);
    expect(applied).toBe(false);
    expect(res[0].status).toBe("skipped");
  });

  it("check false ise apply çalışır (done)", async () => {
    let applied = false;
    const m = mod("a", false, async () => {
      applied = true;
    });
    const res = await runPipeline(new FakeRunner(), [m]);
    expect(applied).toBe(true);
    expect(res[0].status).toBe("done");
  });

  it("apply hata fırlatırsa failed olur ve pipeline durur", async () => {
    const bad = mod("a", false, async () => {
      throw new Error("boom");
    });
    const next = mod("b", false);
    const seen: string[] = [];
    const res = await runPipeline(new FakeRunner(), [bad, next], (r) =>
      void seen.push(r.id),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: "a", status: "failed", error: "boom" });
    expect(seen).toEqual(["a"]);
  });
});
