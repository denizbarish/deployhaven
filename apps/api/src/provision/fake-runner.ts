import type { CommandRunner, ExecResult } from "./command-runner.js";

interface Rule {
  pattern: string | RegExp;
  result: ExecResult;
}

export class FakeRunner implements CommandRunner {
  calls: string[] = [];
  uploads: { path: string; content: string }[] = [];
  private rules: Rule[] = [];

  script(pattern: string | RegExp, result: Partial<ExecResult>): this {
    this.rules.push({
      pattern,
      result: { stdout: "", stderr: "", code: 0, ...result },
    });
    return this;
  }

  async exec(command: string, opts?: { sudo?: boolean }): Promise<ExecResult> {
    const full = opts?.sudo ? `sudo ${command}` : command;
    this.calls.push(full);
    for (const rule of this.rules) {
      const hit =
        typeof rule.pattern === "string"
          ? full.includes(rule.pattern)
          : rule.pattern.test(full);
      if (hit) return rule.result;
    }
    return { stdout: "", stderr: "", code: 0 };
  }

  async uploadFile(content: string, remotePath: string): Promise<void> {
    this.uploads.push({ path: remotePath, content });
  }
}
