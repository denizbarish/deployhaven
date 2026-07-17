import type { CommandRunner } from "./command-runner.js";

export interface ProvisionModule {
  id: string;
  label: string;
  check(runner: CommandRunner): Promise<boolean>;
  apply(runner: CommandRunner): Promise<void>;
}

export type StepStatus = "skipped" | "done" | "failed";
export interface StepResult {
  id: string;
  status: StepStatus;
  error?: string;
}

export async function runPipeline(
  runner: CommandRunner,
  modules: ProvisionModule[],
  onStep?: (r: StepResult) => void | Promise<void>,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const mod of modules) {
    let result: StepResult;
    try {
      const done = await mod.check(runner);
      if (done) {
        result = { id: mod.id, status: "skipped" };
      } else {
        await mod.apply(runner);
        result = { id: mod.id, status: "done" };
      }
    } catch (err) {
      result = {
        id: mod.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(result);
    if (onStep) await onStep(result);
    if (result.status === "failed") break;
  }
  return results;
}
