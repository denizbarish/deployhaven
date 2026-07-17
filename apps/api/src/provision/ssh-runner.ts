import { createHash, timingSafeEqual } from "node:crypto";
import { Client } from "ssh2";
import type { CommandRunner, ExecResult } from "./command-runner.js";

export function buildRemoteCommand(command: string, opts?: { sudo?: boolean }): string {
  return opts?.sudo ? `sudo -n ${command}` : command;
}

/**
 * Sunulan host anahtarının SHA-256 fingerprint'ini (hex) hesaplar.
 * `ssh2`, `hostVerifier`'a ham host anahtarını Buffer olarak verir (hostHash set edilmediğinde).
 */
export function computeHostKeyFingerprint(hostKey: Buffer): string {
  return createHash("sha256").update(hostKey).digest("hex");
}

/**
 * TOFU + pinning host-key doğrulama kararı (saf, test edilebilir).
 * - `expected` verilmişse: yalnızca sabit-zamanlı tam eşleşmede kabul, aksi halde red.
 * - `expected` yoksa (ilk bağlantı / TOFU): kabul; çağıran gözlenen fingerprint'i persist etmeli.
 */
export function verifyHostKey(
  observed: string,
  expected: string | null | undefined,
): boolean {
  if (!expected) return true;
  const a = Buffer.from(observed);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** Kayıtlı (pinlenmiş) host-key fingerprint'i. Verilirse tam eşleşme zorunlu. */
  expectedFingerprint?: string | null;
}

export class SshRunner implements CommandRunner {
  private constructor(
    private readonly client: Client,
    /** Bu bağlantıda gözlenen host-key fingerprint'i (SHA-256 hex). Çağıran TOFU'da persist eder. */
    readonly hostKeyFingerprint: string,
  ) {}

  static connect(cfg: SshConfig): Promise<SshRunner> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let observedFingerprint = "";
      client
        .on("ready", () => resolve(new SshRunner(client, observedFingerprint)))
        .on("error", reject)
        .connect({
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          privateKey: cfg.privateKey,
          hostVerifier: (hostKey: Buffer, callback: (valid: boolean) => void) => {
            observedFingerprint = computeHostKeyFingerprint(hostKey);
            callback(verifyHostKey(observedFingerprint, cfg.expectedFingerprint));
          },
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
