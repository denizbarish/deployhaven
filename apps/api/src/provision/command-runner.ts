export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandRunner {
  exec(command: string, opts?: { sudo?: boolean }): Promise<ExecResult>;
  uploadFile(
    content: string,
    remotePath: string,
    opts?: { mode?: string },
  ): Promise<void>;
}
