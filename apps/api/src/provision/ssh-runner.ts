import { Client } from "ssh2";
import type { CommandRunner, ExecResult } from "./command-runner.js";

export function buildRemoteCommand(command: string, opts?: { sudo?: boolean }): string {
  return opts?.sudo ? `sudo -n ${command}` : command;
}

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

export class SshRunner implements CommandRunner {
  private constructor(private readonly client: Client) {}

  static connect(cfg: SshConfig): Promise<SshRunner> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => resolve(new SshRunner(client)))
        .on("error", reject)
        .connect({
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          privateKey: cfg.privateKey,
        });
    });
  }

  exec(command: string, opts?: { sudo?: boolean }): Promise<ExecResult> {
    const remote = buildRemoteCommand(command, opts);
    return new Promise((resolve, reject) => {
      this.client.exec(remote, (err, stream) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        stream
          .on("close", (code: number) => resolve({ stdout, stderr, code: code ?? 0 }))
          .on("data", (d: Buffer) => (stdout += d.toString()))
          .stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      });
    });
  }

  uploadFile(content: string, remotePath: string, opts?: { mode?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        const ws = sftp.createWriteStream(remotePath, {
          mode: opts?.mode ? parseInt(opts.mode, 8) : undefined,
        });
        ws.on("close", () => resolve());
        ws.on("error", reject);
        ws.end(content);
      });
    });
  }

  close(): void {
    this.client.end();
  }
}
