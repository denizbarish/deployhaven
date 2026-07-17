# Deployhaven M1 (Provizyon + Sertleştirme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boş bir Ubuntu sunucusunu SSH üzerinden (agentless) uçtan uca provizyonla: güvenlik sertleştirme, Docker, Traefik ve Deployhaven agent kurulumu; panelden sunucu ekle, provizyonu kuyruğa al, canlı ilerlemeyi izle.

**Architecture:** Modüller `CommandRunner` arayüzüne bağımlıdır (SSH-backed `SshRunner` + testler için `FakeRunner`), böylece tüm provizyon mantığı gerçek sunucu olmadan birim test edilir. Her modül idempotenttir: `check()` durumu doğrularsa `apply()` atlanır. Pipeline her adımı `ProvisionRun` tablosuna yazar. Provizyon işleri BullMQ (Redis) kuyruğunda koşar; panel ilerlemeyi SSE ile izler. Gerçek uçtan uca doğrulama, CI dışı opt-in bir tek kullanımlık VM harness'iyle yapılır.

**Tech Stack:** TypeScript strict, NestJS, ssh2, BullMQ + Redis, Prisma/Postgres, Vitest. Reverse proxy Traefik. Agent: Node + systemd.

## Global Constraints

- TypeScript `strict: true`; paketler `@deployhaven/*` scope.
- Node 20+ / pnpm (pinned `pnpm@9.12.0`).
- Provizyon modülleri **idempotent** (tekrar çalıştırılabilir, `check()` + `apply()`).
- Modüller doğrudan `ssh2`'ye değil `CommandRunner` arayüzüne bağımlı olmalı (test edilebilirlik).
- SSH kimlik bilgileri (özel anahtar/parola) **at-rest şifreli** saklanır; asla loglanmaz.
- En az yetki: provizyon `deploy` adında non-root kullanıcı oluşturur; root login + parola auth kapatılır.
- Firewall varsayılan: gelen deny, giden allow, yalnız gerekli portlar açık.
- Çıktıda uzun tire (—, –) yasak; virgül/iki nokta/parantez kullan.
- Her task kendi test döngüsüyle biter ve ayrı commit alır. Modül testleri `FakeRunner` kullanır (gerçek sunucu yok).

## File Structure

- `apps/api/src/provision/command-runner.ts` — `CommandRunner` arayüzü + tipler
- `apps/api/src/provision/fake-runner.ts` — testler için sahte runner
- `apps/api/src/provision/ssh-runner.ts` — ssh2 tabanlı gerçek runner
- `apps/api/src/provision/module.ts` — `ProvisionModule` arayüzü + `runPipeline`
- `apps/api/src/provision/modules/*.ts` — tekil modüller (precheck, system-update, ssh-hardening, ufw, fail2ban, docker, traefik, agent-install)
- `apps/api/src/crypto/secret-box.ts` — secrets şifreleme yardımcıları
- `apps/api/src/servers/*` — Server CRUD (controller/service/dto/module)
- `apps/api/src/provision/provision.queue.ts`, `provision.processor.ts`, `provision.controller.ts` — kuyruk + tetikleme + ilerleme
- `apps/agent/*` — Deployhaven agent (Node, enrollment + heartbeat)
- `scripts/vm-provision-check.sh` + `docs/provisioning-vm-test.md` — opt-in VM harness

---

### Task 1: CommandRunner arayüzü + FakeRunner

**Files:**
- Create: `apps/api/src/provision/command-runner.ts`
- Create: `apps/api/src/provision/fake-runner.ts`
- Create: `apps/api/src/provision/fake-runner.test.ts`

**Interfaces:**
- Consumes: yok.
- Produces:
  ```ts
  export interface ExecResult { stdout: string; stderr: string; code: number; }
  export interface CommandRunner {
    exec(command: string, opts?: { sudo?: boolean }): Promise<ExecResult>;
    uploadFile(content: string, remotePath: string, opts?: { mode?: string }): Promise<void>;
  }
  ```
  `FakeRunner implements CommandRunner`: `script(pattern: string | RegExp, result: Partial<ExecResult>)` ile yanıt kurgular; `calls: string[]` çağrılan komutları, `uploads: {path,content}[]` yüklemeleri kaydeder; eşleşmeyen komut varsayılan `{stdout:"",stderr:"",code:0}` döner.

- [ ] **Step 1: Testi yaz (`fake-runner.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "./fake-runner.js";

describe("FakeRunner", () => {
  it("çağrılan komutları kaydeder ve varsayılan 0 döner", async () => {
    const r = new FakeRunner();
    const res = await r.exec("whoami");
    expect(res.code).toBe(0);
    expect(r.calls).toContain("whoami");
  });

  it("script edilen desene göre yanıt döner", async () => {
    const r = new FakeRunner();
    r.script(/docker --version/, { stdout: "Docker version 27", code: 0 });
    const res = await r.exec("docker --version");
    expect(res.stdout).toContain("Docker version");
  });

  it("sudo bayrağını komut önekine yansıtır", async () => {
    const r = new FakeRunner();
    await r.exec("apt-get update", { sudo: true });
    expect(r.calls.some((c) => c.startsWith("sudo "))).toBe(true);
  });

  it("uploadFile yüklemeleri kaydeder", async () => {
    const r = new FakeRunner();
    await r.uploadFile("hello", "/tmp/x");
    expect(r.uploads).toEqual([{ path: "/tmp/x", content: "hello" }]);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test fake-runner`
Expected: FAIL (modül yok).

- [ ] **Step 3: `command-runner.ts` yaz**

```ts
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
```

- [ ] **Step 4: `fake-runner.ts` yaz**

```ts
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
```

- [ ] **Step 5: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test fake-runner`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/provision/command-runner.ts apps/api/src/provision/fake-runner.ts apps/api/src/provision/fake-runner.test.ts
git commit -m "feat(provision): CommandRunner arayüzü + test için FakeRunner"
```

---

### Task 2: Provizyon modül çerçevesi + pipeline

**Files:**
- Create: `apps/api/src/provision/module.ts`
- Create: `apps/api/src/provision/module.test.ts`

**Interfaces:**
- Consumes: `CommandRunner` (Task 1).
- Produces:
  ```ts
  export interface ProvisionModule {
    id: string;
    label: string;
    check(runner: CommandRunner): Promise<boolean>;
    apply(runner: CommandRunner): Promise<void>;
  }
  export type StepStatus = "skipped" | "done" | "failed";
  export interface StepResult { id: string; status: StepStatus; error?: string; }
  export function runPipeline(
    runner: CommandRunner,
    modules: ProvisionModule[],
    onStep?: (r: StepResult) => void | Promise<void>,
  ): Promise<StepResult[]>;
  ```
  Davranış: her modül için `check()` true ise `skipped`; değilse `apply()` çağrılır, hatasızsa `done`, hata fırlatırsa `failed` (hata mesajı yakalanır) ve pipeline durur (kalan modüller çalışmaz). Her adım sonrası `onStep` çağrılır.

- [ ] **Step 1: Testi yaz (`module.test.ts`)**

```ts
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
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test module`
Expected: FAIL (modül yok).

- [ ] **Step 3: `module.ts` yaz**

```ts
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
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test module`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/module.ts apps/api/src/provision/module.test.ts
git commit -m "feat(provision): idempotent modül çerçevesi + runPipeline"
```

---

### Task 3: precheck modülü

**Files:**
- Create: `apps/api/src/provision/modules/precheck.ts`
- Create: `apps/api/src/provision/modules/precheck.test.ts`

**Interfaces:**
- Consumes: `ProvisionModule`, `CommandRunner` (Task 1-2).
- Produces: `precheckModule: ProvisionModule` (id `precheck`). `check()` daima `false` (doğrulama her zaman koşar). `apply()`: `. /etc/os-release` okur; `ID=ubuntu` ve `VERSION_ID` 22.04/24.04 değilse hata; `sudo -n true` başarısızsa hata.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { precheckModule } from "./precheck.js";

describe("precheck", () => {
  it("ubuntu 24.04 + sudo varsa apply hatasız geçer", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=ubuntu\nVERSION_ID="24.04"' });
    r.script("sudo -n true", { code: 0 });
    await expect(precheckModule.apply(r)).resolves.toBeUndefined();
  });

  it("desteklenmeyen OS'te hata fırlatır", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=centos\nVERSION_ID="9"' });
    await expect(precheckModule.apply(r)).rejects.toThrow(/desteklenmeyen|unsupported/i);
  });

  it("sudo yoksa hata fırlatır", async () => {
    const r = new FakeRunner();
    r.script("os-release", { stdout: 'ID=ubuntu\nVERSION_ID="22.04"' });
    r.script("sudo -n true", { code: 1, stderr: "a password is required" });
    await expect(precheckModule.apply(r)).rejects.toThrow(/sudo/i);
  });

  it("check daima false döner", async () => {
    expect(await precheckModule.check(new FakeRunner())).toBe(false);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test precheck`
Expected: FAIL.

- [ ] **Step 3: `precheck.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

const SUPPORTED = ["22.04", "24.04"];

export const precheckModule: ProvisionModule = {
  id: "precheck",
  label: "Ön kontrol (OS, sudo)",
  async check() {
    return false;
  },
  async apply(runner) {
    const os = await runner.exec("cat /etc/os-release");
    const id = /^ID=("?)(\w+)\1/m.exec(os.stdout)?.[2];
    const version = /^VERSION_ID="?([\d.]+)"?/m.exec(os.stdout)?.[1];
    if (id !== "ubuntu" || !version || !SUPPORTED.includes(version)) {
      throw new Error(
        `desteklenmeyen OS: ${id ?? "?"} ${version ?? "?"} (Ubuntu 22.04/24.04 gerekli)`,
      );
    }
    const sudo = await runner.exec("sudo -n true");
    if (sudo.code !== 0) {
      throw new Error("sudo (parolasız) erişimi yok");
    }
  },
};
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test precheck`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/precheck.ts apps/api/src/provision/modules/precheck.test.ts
git commit -m "feat(provision): precheck modülü (OS + sudo doğrulama)"
```

---

### Task 4: system-update modülü

**Files:**
- Create: `apps/api/src/provision/modules/system-update.ts`
- Create: `apps/api/src/provision/modules/system-update.test.ts`

**Interfaces:**
- Produces: `systemUpdateModule: ProvisionModule` (id `system-update`). `check()`: `dpkg -s ca-certificates curl gnupg` hepsi kuruluysa true. `apply()`: `apt-get update`, `DEBIAN_FRONTEND=noninteractive apt-get -y upgrade`, temel paketleri kur (`ca-certificates curl gnupg lsb-release`), hepsi `sudo` ile.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { systemUpdateModule } from "./system-update.js";

describe("system-update", () => {
  it("temel paketler kuruluysa check true", async () => {
    const r = new FakeRunner();
    r.script(/dpkg -s/, { code: 0 });
    expect(await systemUpdateModule.check(r)).toBe(true);
  });

  it("paket eksikse check false", async () => {
    const r = new FakeRunner();
    r.script(/dpkg -s/, { code: 1 });
    expect(await systemUpdateModule.check(r)).toBe(false);
  });

  it("apply apt update + upgrade + kurulum çalıştırır (sudo)", async () => {
    const r = new FakeRunner();
    await systemUpdateModule.apply(r);
    expect(r.calls.some((c) => /sudo apt-get update/.test(c))).toBe(true);
    expect(r.calls.some((c) => /apt-get -y upgrade/.test(c))).toBe(true);
    expect(r.calls.some((c) => /apt-get -y install .*ca-certificates/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test system-update`
Expected: FAIL.

- [ ] **Step 3: `system-update.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

const BASE = "ca-certificates curl gnupg lsb-release";

export const systemUpdateModule: ProvisionModule = {
  id: "system-update",
  label: "Sistem güncelleme + temel paketler",
  async check(runner) {
    const res = await runner.exec(`dpkg -s ${BASE}`);
    return res.code === 0;
  },
  async apply(runner) {
    await runner.exec("apt-get update", { sudo: true });
    await runner.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get -y upgrade",
      { sudo: true },
    );
    await runner.exec(
      `DEBIAN_FRONTEND=noninteractive apt-get -y install ${BASE}`,
      { sudo: true },
    );
  },
};
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test system-update`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/system-update.ts apps/api/src/provision/modules/system-update.test.ts
git commit -m "feat(provision): system-update modülü (apt update/upgrade + temel paketler)"
```

---

### Task 5: deploy-user + SSH sertleştirme modülü

**Files:**
- Create: `apps/api/src/provision/modules/ssh-hardening.ts`
- Create: `apps/api/src/provision/modules/ssh-hardening.test.ts`

**Interfaces:**
- Produces: `sshHardeningModule(publicKey: string): ProvisionModule` (id `ssh-hardening`, fabrika, verilen public key'i `deploy` kullanıcısına yazar). `check()`: `deploy` kullanıcısı var (`id deploy`) ve sshd'de `PermitRootLogin no` + `PasswordAuthentication no` ayarlıysa true. `apply()`: `deploy` kullanıcısı + sudo grubu oluştur, `~deploy/.ssh/authorized_keys`'e public key yükle (mode 600), sshd config'e drop-in (`/etc/ssh/sshd_config.d/deployhaven.conf`) yaz (root login + parola auth kapalı), `sshd -t` ile doğrula, `systemctl reload ssh`.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { sshHardeningModule } from "./ssh-hardening.js";

const KEY = "ssh-ed25519 AAAAC3Nz deniz@dh";

describe("ssh-hardening", () => {
  it("deploy kullanıcısı + hardening drop-in varsa check true", async () => {
    const r = new FakeRunner();
    r.script("id deploy", { code: 0 });
    r.script(/grep .*PermitRootLogin no/, { code: 0 });
    r.script(/grep .*PasswordAuthentication no/, { code: 0 });
    expect(await sshHardeningModule(KEY).check(r)).toBe(true);
  });

  it("deploy kullanıcısı yoksa check false", async () => {
    const r = new FakeRunner();
    r.script("id deploy", { code: 1 });
    expect(await sshHardeningModule(KEY).check(r)).toBe(false);
  });

  it("apply kullanıcı oluşturur, anahtar yükler, sshd doğrular ve reload eder", async () => {
    const r = new FakeRunner();
    await sshHardeningModule(KEY).apply(r);
    expect(r.calls.some((c) => /useradd .*deploy/.test(c))).toBe(true);
    expect(r.uploads.some((u) => u.path.includes("authorized_keys") && u.content.includes(KEY))).toBe(true);
    expect(r.uploads.some((u) => u.path.includes("sshd_config.d") && /PermitRootLogin no/.test(u.content))).toBe(true);
    expect(r.calls.some((c) => /sshd -t/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl reload ssh/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test ssh-hardening`
Expected: FAIL.

- [ ] **Step 3: `ssh-hardening.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

const DROPIN = "/etc/ssh/sshd_config.d/deployhaven.conf";
const HARDENING = "PermitRootLogin no\nPasswordAuthentication no\n";

export function sshHardeningModule(publicKey: string): ProvisionModule {
  return {
    id: "ssh-hardening",
    label: "deploy kullanıcısı + SSH sertleştirme",
    async check(runner) {
      const user = await runner.exec("id deploy");
      if (user.code !== 0) return false;
      const root = await runner.exec(`grep -q '^PermitRootLogin no' ${DROPIN}`, { sudo: true });
      const pass = await runner.exec(`grep -q '^PasswordAuthentication no' ${DROPIN}`, { sudo: true });
      return root.code === 0 && pass.code === 0;
    },
    async apply(runner) {
      await runner.exec("useradd -m -s /bin/bash -G sudo deploy || true", { sudo: true });
      await runner.exec("mkdir -p /home/deploy/.ssh", { sudo: true });
      await runner.uploadFile(publicKey + "\n", "/home/deploy/.ssh/authorized_keys", { mode: "600" });
      await runner.exec("chown -R deploy:deploy /home/deploy/.ssh", { sudo: true });
      await runner.exec("chmod 700 /home/deploy/.ssh", { sudo: true });
      await runner.uploadFile(HARDENING, DROPIN, { mode: "644" });
      const test = await runner.exec("sshd -t", { sudo: true });
      if (test.code !== 0) throw new Error(`sshd config geçersiz: ${test.stderr}`);
      await runner.exec("systemctl reload ssh", { sudo: true });
    },
  };
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test ssh-hardening`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/ssh-hardening.ts apps/api/src/provision/modules/ssh-hardening.test.ts
git commit -m "feat(provision): deploy kullanıcısı + SSH sertleştirme modülü"
```

---

### Task 6: UFW firewall modülü

**Files:**
- Create: `apps/api/src/provision/modules/ufw.ts`
- Create: `apps/api/src/provision/modules/ufw.test.ts`

**Interfaces:**
- Produces: `ufwModule(allowPorts: number[]): ProvisionModule` (id `ufw`). Varsayılan çağrı `ufwModule([80, 443])`. `check()`: `ufw status` çıktısı `Status: active` içeriyorsa true. `apply()`: ufw kur, `default deny incoming`, `default allow outgoing`, `allow OpenSSH`, verilen portları `allow`, `--force enable`.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { ufwModule } from "./ufw.js";

describe("ufw", () => {
  it("ufw aktifse check true", async () => {
    const r = new FakeRunner();
    r.script("ufw status", { stdout: "Status: active" });
    expect(await ufwModule([80, 443]).check(r)).toBe(true);
  });

  it("ufw pasifse check false", async () => {
    const r = new FakeRunner();
    r.script("ufw status", { stdout: "Status: inactive" });
    expect(await ufwModule([80, 443]).check(r)).toBe(false);
  });

  it("apply default deny + OpenSSH + portlar + enable", async () => {
    const r = new FakeRunner();
    await ufwModule([80, 443]).apply(r);
    expect(r.calls.some((c) => /ufw default deny incoming/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow OpenSSH/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow 80/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw allow 443/.test(c))).toBe(true);
    expect(r.calls.some((c) => /ufw --force enable/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test ufw`
Expected: FAIL.

- [ ] **Step 3: `ufw.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

export function ufwModule(allowPorts: number[]): ProvisionModule {
  return {
    id: "ufw",
    label: "Firewall (UFW)",
    async check(runner) {
      const res = await runner.exec("ufw status", { sudo: true });
      return /Status:\s*active/.test(res.stdout);
    },
    async apply(runner) {
      await runner.exec(
        "DEBIAN_FRONTEND=noninteractive apt-get -y install ufw",
        { sudo: true },
      );
      await runner.exec("ufw default deny incoming", { sudo: true });
      await runner.exec("ufw default allow outgoing", { sudo: true });
      await runner.exec("ufw allow OpenSSH", { sudo: true });
      for (const port of allowPorts) {
        await runner.exec(`ufw allow ${port}`, { sudo: true });
      }
      await runner.exec("ufw --force enable", { sudo: true });
    },
  };
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test ufw`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/ufw.ts apps/api/src/provision/modules/ufw.test.ts
git commit -m "feat(provision): UFW firewall modülü"
```

---

### Task 7: fail2ban + unattended-upgrades modülü

**Files:**
- Create: `apps/api/src/provision/modules/auto-defense.ts`
- Create: `apps/api/src/provision/modules/auto-defense.test.ts`

**Interfaces:**
- Produces: `autoDefenseModule: ProvisionModule` (id `auto-defense`). `check()`: `systemctl is-enabled fail2ban` ve `unattended-upgrades` ikisi de `enabled` ise true. `apply()`: her ikisini kur, enable + start, unattended-upgrades'i `dpkg-reconfigure -f noninteractive` ile etkinleştir.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { autoDefenseModule } from "./auto-defense.js";

describe("auto-defense", () => {
  it("iki servis de enabled ise check true", async () => {
    const r = new FakeRunner();
    r.script(/is-enabled fail2ban/, { stdout: "enabled", code: 0 });
    r.script(/is-enabled unattended-upgrades/, { stdout: "enabled", code: 0 });
    expect(await autoDefenseModule.check(r)).toBe(true);
  });

  it("biri eksikse check false", async () => {
    const r = new FakeRunner();
    r.script(/is-enabled fail2ban/, { stdout: "enabled", code: 0 });
    r.script(/is-enabled unattended-upgrades/, { code: 1 });
    expect(await autoDefenseModule.check(r)).toBe(false);
  });

  it("apply kurar ve enable eder", async () => {
    const r = new FakeRunner();
    await autoDefenseModule.apply(r);
    expect(r.calls.some((c) => /apt-get -y install .*fail2ban/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl enable --now fail2ban/.test(c))).toBe(true);
    expect(r.calls.some((c) => /dpkg-reconfigure -f noninteractive unattended-upgrades/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test auto-defense`
Expected: FAIL.

- [ ] **Step 3: `auto-defense.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

export const autoDefenseModule: ProvisionModule = {
  id: "auto-defense",
  label: "fail2ban + otomatik güvenlik güncellemeleri",
  async check(runner) {
    const f2b = await runner.exec("systemctl is-enabled fail2ban", { sudo: true });
    const uu = await runner.exec("systemctl is-enabled unattended-upgrades", { sudo: true });
    return f2b.code === 0 && uu.code === 0;
  },
  async apply(runner) {
    await runner.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get -y install fail2ban unattended-upgrades",
      { sudo: true },
    );
    await runner.exec("systemctl enable --now fail2ban", { sudo: true });
    await runner.exec(
      "dpkg-reconfigure -f noninteractive unattended-upgrades",
      { sudo: true },
    );
    await runner.exec("systemctl enable --now unattended-upgrades", { sudo: true });
  },
};
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test auto-defense`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/auto-defense.ts apps/api/src/provision/modules/auto-defense.test.ts
git commit -m "feat(provision): fail2ban + unattended-upgrades modülü"
```

---

### Task 8: Docker kurulum modülü

**Files:**
- Create: `apps/api/src/provision/modules/docker.ts`
- Create: `apps/api/src/provision/modules/docker.test.ts`

**Interfaces:**
- Produces: `dockerModule: ProvisionModule` (id `docker`). `check()`: `docker --version` çalışıyorsa (code 0) true. `apply()`: Docker resmi apt reposunu ekle (keyring + source list), `docker-ce docker-ce-cli containerd.io docker-compose-plugin` kur, `deploy` kullanıcısını `docker` grubuna ekle, servisi enable et.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { dockerModule } from "./docker.js";

describe("docker", () => {
  it("docker kuruluysa check true", async () => {
    const r = new FakeRunner();
    r.script("docker --version", { stdout: "Docker version 27.1", code: 0 });
    expect(await dockerModule.check(r)).toBe(true);
  });

  it("docker yoksa check false", async () => {
    const r = new FakeRunner();
    r.script("docker --version", { code: 127 });
    expect(await dockerModule.check(r)).toBe(false);
  });

  it("apply repo ekler, paketleri kurar, deploy'u docker grubuna alır", async () => {
    const r = new FakeRunner();
    await dockerModule.apply(r);
    expect(r.calls.some((c) => /apt-get -y install .*docker-ce/.test(c))).toBe(true);
    expect(r.calls.some((c) => /docker-compose-plugin/.test(c))).toBe(true);
    expect(r.calls.some((c) => /usermod -aG docker deploy/.test(c))).toBe(true);
    expect(r.calls.some((c) => /systemctl enable --now docker/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test modules/docker`
Expected: FAIL.

- [ ] **Step 3: `docker.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

const KEYRING = "/etc/apt/keyrings/docker.asc";
const LIST = "/etc/apt/sources.list.d/docker.list";

export const dockerModule: ProvisionModule = {
  id: "docker",
  label: "Docker Engine + Compose",
  async check(runner) {
    const res = await runner.exec("docker --version");
    return res.code === 0;
  },
  async apply(runner) {
    await runner.exec("install -m 0755 -d /etc/apt/keyrings", { sudo: true });
    await runner.exec(
      `curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o ${KEYRING}`,
      { sudo: true },
    );
    await runner.exec(`chmod a+r ${KEYRING}`, { sudo: true });
    await runner.exec(
      `bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=${KEYRING}] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > ${LIST}'`,
      { sudo: true },
    );
    await runner.exec("apt-get update", { sudo: true });
    await runner.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
      { sudo: true },
    );
    await runner.exec("usermod -aG docker deploy", { sudo: true });
    await runner.exec("systemctl enable --now docker", { sudo: true });
  },
};
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test modules/docker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/docker.ts apps/api/src/provision/modules/docker.test.ts
git commit -m "feat(provision): Docker Engine + Compose kurulum modülü"
```

---

### Task 9: Traefik deploy modülü

**Files:**
- Create: `apps/api/src/provision/modules/traefik.ts`
- Create: `apps/api/src/provision/modules/traefik.test.ts`

**Interfaces:**
- Produces: `traefikModule(acmeEmail: string): ProvisionModule` (id `traefik`). `check()`: `docker ps --filter name=deployhaven-traefik --filter status=running -q` çıktısı boş değilse true. `apply()`: `/opt/deployhaven/traefik/` altına `docker-compose.yml` + statik config yükle (docker provider, 80/443, Let's Encrypt TLS-ALPN, `web`/`websecure` entrypoints, HTTP-to-HTTPS yönlendirme), `docker network create deployhaven || true`, `docker compose up -d`.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../fake-runner.js";
import { traefikModule } from "./traefik.js";

describe("traefik", () => {
  it("traefik container çalışıyorsa check true", async () => {
    const r = new FakeRunner();
    r.script(/docker ps .*deployhaven-traefik/, { stdout: "abc123" });
    expect(await traefikModule("ops@dh.dev").check(r)).toBe(true);
  });

  it("container yoksa check false", async () => {
    const r = new FakeRunner();
    r.script(/docker ps .*deployhaven-traefik/, { stdout: "" });
    expect(await traefikModule("ops@dh.dev").check(r)).toBe(false);
  });

  it("apply compose + config yükler, network kurar, up -d eder", async () => {
    const r = new FakeRunner();
    await traefikModule("ops@dh.dev").apply(r);
    expect(r.uploads.some((u) => u.path.includes("docker-compose.yml") && u.content.includes("traefik"))).toBe(true);
    expect(r.uploads.some((u) => u.content.includes("ops@dh.dev"))).toBe(true);
    expect(r.calls.some((c) => /docker network create deployhaven/.test(c))).toBe(true);
    expect(r.calls.some((c) => /docker compose .*up -d/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test modules/traefik`
Expected: FAIL.

- [ ] **Step 3: `traefik.ts` yaz**

```ts
import type { ProvisionModule } from "../module.js";

const DIR = "/opt/deployhaven/traefik";

function composeYml(): string {
  return `services:
  traefik:
    image: traefik:v3.1
    container_name: deployhaven-traefik
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.le.acme.tlschallenge=true"
      - "--certificatesresolvers.le.acme.email=\${ACME_EMAIL}"
      - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "letsencrypt:/letsencrypt"
    networks:
      - deployhaven
volumes:
  letsencrypt:
networks:
  deployhaven:
    external: true
`;
}

export function traefikModule(acmeEmail: string): ProvisionModule {
  return {
    id: "traefik",
    label: "Traefik reverse proxy",
    async check(runner) {
      const res = await runner.exec(
        "docker ps --filter name=deployhaven-traefik --filter status=running -q",
        { sudo: true },
      );
      return res.stdout.trim().length > 0;
    },
    async apply(runner) {
      await runner.exec(`mkdir -p ${DIR}`, { sudo: true });
      await runner.uploadFile(composeYml(), `${DIR}/docker-compose.yml`);
      await runner.uploadFile(`ACME_EMAIL=${acmeEmail}\n`, `${DIR}/.env`);
      await runner.exec("docker network create deployhaven || true", { sudo: true });
      await runner.exec(`docker compose -f ${DIR}/docker-compose.yml up -d`, { sudo: true });
    },
  };
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test modules/traefik`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/modules/traefik.ts apps/api/src/provision/modules/traefik.test.ts
git commit -m "feat(provision): Traefik reverse proxy deploy modülü"
```

---

### Task 10: Secrets şifreleme yardımcısı

**Files:**
- Create: `apps/api/src/crypto/secret-box.ts`
- Create: `apps/api/src/crypto/secret-box.test.ts`
- Modify: `.env.example` (SECRET_KEY ekle)

**Interfaces:**
- Consumes: `SECRET_KEY` (base64, 32 bayt) ortam değişkeni.
- Produces: `encryptSecret(plain: string): string` (AES-256-GCM, `iv:tag:ciphertext` base64 formatı), `decryptSecret(cipher: string): string`. Anahtar env'den, yoksa hata.

- [ ] **Step 1: Testi yaz**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.SECRET_KEY = randomBytes(32).toString("base64");
});

describe("secret-box", () => {
  it("şifrele-çöz round-trip", async () => {
    const { encryptSecret, decryptSecret } = await import("./secret-box.js");
    const plain = "ssh-ed25519-private-key-material";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("bozuk cipher çözülünce hata", async () => {
    const { decryptSecret } = await import("./secret-box.js");
    expect(() => decryptSecret("bozuk")).toThrow();
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test secret-box`
Expected: FAIL.

- [ ] **Step 3: `secret-box.ts` yaz**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.SECRET_KEY;
  if (!raw) throw new Error("SECRET_KEY tanımlı değil");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("SECRET_KEY 32 bayt (base64) olmalı");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(cipher: string): string {
  const [ivB, tagB, encB] = cipher.split(":");
  if (!ivB || !tagB || !encB) throw new Error("geçersiz cipher formatı");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: `.env.example`'a ekle**

`.env.example` içine (API bölümüne) ekle:

```
SECRET_KEY="" # openssl rand -base64 32 ile üret; SSH kimlik bilgilerini şifreler
```

- [ ] **Step 5: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test secret-box`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/crypto .env.example
git commit -m "feat(api): AES-256-GCM secrets şifreleme yardımcısı"
```

---

### Task 11: Sunucu CRUD API + şifreli SSH kimlik saklama

**Files:**
- Create: `apps/api/src/servers/dto.ts`
- Create: `apps/api/src/servers/servers.service.ts`
- Create: `apps/api/src/servers/servers.controller.ts`
- Create: `apps/api/src/servers/servers.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/db/prisma/schema.prisma` (Server'a `sshUser`, `sshPort`, `sshKeyCipher` ekle) + migration
- Create: `apps/api/test/servers.e2e.test.ts`

**Interfaces:**
- Consumes: `encryptSecret` (Task 10), `SessionGuard` (M0), `prisma` (M0).
- Produces: `POST /servers` (guarded) `{ name, host, sshUser?, sshPort?, sshPrivateKey }` → 201 `{ id }` (özel anahtar şifreli saklanır, yanıt anahtarı içermez); `GET /servers` (guarded) → kullanıcı team'inin sunucuları (kimlik bilgisi olmadan); `GET /servers/:id` → tek sunucu (kimlik bilgisi maskeli). `ServersService.getSshCredentials(serverId)` (internal, deşifre eder; provizyon processoru kullanır).

- [ ] **Step 1: Şemayı güncelle + migration**

`packages/db/prisma/schema.prisma` `Server` modeline ekle:

```prisma
  sshUser      String  @default("root")
  sshPort      Int     @default(22)
  sshKeyCipher String?
```

Run: `cd packages/db && DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm db:migrate --name server_ssh_creds && pnpm db:generate`
Expected: migration uygulanır, client yeniden üretilir.

- [ ] **Step 2: Testi yaz (`servers.e2e.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "srv@dh.test";

describe("Servers CRUD", () => {
  let app: INestApplication;
  let cookie: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("sunucu oluşturur, özel anahtarı yanıtta döndürmez, şifreli saklar", async () => {
    const res = await request(app.getHttpServer())
      .post("/servers")
      .set("Cookie", cookie)
      .send({ name: "vps1", host: "10.0.0.1", sshPrivateKey: "SECRET-KEY-MATERIAL" });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("SECRET-KEY-MATERIAL");
    const row = await prisma.server.findUnique({ where: { id: res.body.id } });
    expect(row?.sshKeyCipher).toBeTruthy();
    expect(row?.sshKeyCipher).not.toContain("SECRET-KEY-MATERIAL");
  });

  it("çerezsiz 401", async () => {
    const res = await request(app.getHttpServer()).get("/servers");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm test servers`
Expected: FAIL (route yok).

- [ ] **Step 4: `dto.ts` yaz**

```ts
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateServerDto {
  @IsString() name!: string;
  @IsString() host!: string;
  @IsOptional() @IsString() sshUser?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) sshPort?: number;
  @IsString() sshPrivateKey!: string;
}
```

- [ ] **Step 5: `servers.service.ts` yaz**

```ts
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@deployhaven/db";
import { encryptSecret, decryptSecret } from "../crypto/secret-box.js";
import type { CreateServerDto } from "./dto.js";

@Injectable()
export class ServersService {
  private async teamIdFor(userId: string): Promise<string> {
    const m = await prisma.membership.findFirst({ where: { userId } });
    if (!m) throw new ForbiddenException("takım yok");
    return m.teamId;
  }

  async create(userId: string, dto: CreateServerDto) {
    const teamId = await this.teamIdFor(userId);
    const server = await prisma.server.create({
      data: {
        name: dto.name,
        host: dto.host,
        sshUser: dto.sshUser ?? "root",
        sshPort: dto.sshPort ?? 22,
        sshKeyCipher: encryptSecret(dto.sshPrivateKey),
        teamId,
      },
    });
    return { id: server.id };
  }

  async list(userId: string) {
    const teamId = await this.teamIdFor(userId);
    return prisma.server.findMany({
      where: { teamId },
      select: { id: true, name: true, host: true, sshUser: true, sshPort: true, createdAt: true },
    });
  }

  async getSshCredentials(serverId: string) {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server?.sshKeyCipher) throw new NotFoundException("sunucu/kimlik yok");
    return {
      host: server.host,
      user: server.sshUser,
      port: server.sshPort,
      privateKey: decryptSecret(server.sshKeyCipher),
    };
  }
}
```

- [ ] **Step 6: `servers.controller.ts` yaz**

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard.js";
import { ServersService } from "./servers.service.js";
import { CreateServerDto } from "./dto.js";

@Controller("servers")
@UseGuards(SessionGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post()
  create(@Req() req: Request & { userId: string }, @Body() dto: CreateServerDto) {
    return this.servers.create(req.userId, dto);
  }

  @Get()
  list(@Req() req: Request & { userId: string }) {
    return this.servers.list(req.userId);
  }
}
```

- [ ] **Step 7: `servers.module.ts` yaz + `app.module.ts`'e ekle**

```ts
import { Module } from "@nestjs/common";
import { ServersController } from "./servers.controller.js";
import { ServersService } from "./servers.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ServersController],
  providers: [ServersService],
  exports: [ServersService],
})
export class ServersModule {}
```

`app.module.ts` imports dizisine `ServersModule` ekle (mevcut `AuthModule`'ün yanına). `SessionGuard`'ın DI ile çözülmesi için `AuthModule`'ün `SessionGuard`'ı export ettiğinden emin ol (etmezse `AuthModule`'e `exports: [AuthService, SessionGuard]` ekle).

- [ ] **Step 8: Testleri çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm test servers`
Expected: PASS. Ayrıca tüm auth testlerinin hâlâ geçtiğini doğrula.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/servers apps/api/src/app.module.ts apps/api/src/auth/auth.module.ts packages/db apps/api/test/servers.e2e.test.ts
git commit -m "feat(api): sunucu CRUD + şifreli SSH kimlik saklama"
```

---

### Task 12: SshRunner (ssh2 gerçek runner)

**Files:**
- Create: `apps/api/src/provision/ssh-runner.ts`
- Create: `apps/api/src/provision/ssh-runner.test.ts`

**Interfaces:**
- Consumes: `CommandRunner` (Task 1), `ssh2`.
- Produces: `SshRunner implements CommandRunner`, `connect(cfg: { host, port, username, privateKey }): Promise<SshRunner>` statik fabrika; `exec` komutları SSH ile koşturur (sudo bayrağı `sudo ` öneki ekler), `uploadFile` SFTP ile yazar (mode uygular), `close()` bağlantıyı kapatır. Not: bu task ssh2'yi sarar; birim testi yalnız komut-önek/format mantığını doğrular (gerçek SSH gerektirmez), gerçek bağlantı VM harness'inde (Task 16) doğrulanır.

- [ ] **Step 1: Testi yaz (saf format mantığı, ssh2 mock)**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRemoteCommand } from "./ssh-runner.js";

describe("SshRunner komut formatı", () => {
  it("sudo bayrağı 'sudo -n' öneki ekler", () => {
    expect(buildRemoteCommand("apt-get update", { sudo: true })).toBe("sudo -n apt-get update");
  });
  it("sudo yoksa komut aynen kalır", () => {
    expect(buildRemoteCommand("whoami")).toBe("whoami");
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test ssh-runner`
Expected: FAIL.

- [ ] **Step 3: `ssh-runner.ts` yaz**

```ts
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
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test ssh-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/ssh-runner.ts apps/api/src/provision/ssh-runner.test.ts
git commit -m "feat(provision): ssh2 tabanlı SshRunner"
```

---

### Task 13: Provizyon kuyruğu + tetikleme + processor

**Files:**
- Create: `apps/api/src/queue/queue.module.ts`
- Create: `apps/api/src/provision/provision.pipeline.ts`
- Create: `apps/api/src/provision/provision.processor.ts`
- Create: `apps/api/src/provision/provision.controller.ts`
- Create: `apps/api/src/provision/provision.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/provision/provision.pipeline.test.ts`

**Interfaces:**
- Consumes: `runPipeline` + tüm modüller (Task 2-9), `SshRunner` (Task 12), `ServersService.getSshCredentials` (Task 11), `prisma` (ProvisionRun), BullMQ + `REDIS_URL`.
- Produces: `buildModules(opts: { publicKey: string; acmeEmail: string }): ProvisionModule[]` (modül sırasını üretir); `POST /servers/:id/provision` (guarded) → 202 `{ jobId }` (işi kuyruğa alır); worker: server kimlik bilgisiyle `SshRunner` kurar, `runPipeline` koşar, her adımı `ProvisionRun` satırı yazar. Bu task'te birim testi `buildModules`'ün doğru modül sırasını ve id'lerini ürettiğini doğrular (gerçek SSH yok).

- [ ] **Step 1: Testi yaz (`provision.pipeline.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { buildModules } from "./provision.pipeline.js";

describe("buildModules", () => {
  it("doğru sırada beklenen modül id'lerini üretir", () => {
    const ids = buildModules({ publicKey: "ssh-ed25519 x", acmeEmail: "a@b.c" }).map((m) => m.id);
    expect(ids).toEqual([
      "precheck",
      "system-update",
      "ssh-hardening",
      "ufw",
      "auto-defense",
      "docker",
      "traefik",
    ]);
  });
});
```

- [ ] **Step 2: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test pnpm test provision.pipeline`
Expected: FAIL.

- [ ] **Step 3: `provision.pipeline.ts` yaz**

```ts
import type { ProvisionModule } from "./module.js";
import { precheckModule } from "./modules/precheck.js";
import { systemUpdateModule } from "./modules/system-update.js";
import { sshHardeningModule } from "./modules/ssh-hardening.js";
import { ufwModule } from "./modules/ufw.js";
import { autoDefenseModule } from "./modules/auto-defense.js";
import { dockerModule } from "./modules/docker.js";
import { traefikModule } from "./modules/traefik.js";

export function buildModules(opts: {
  publicKey: string;
  acmeEmail: string;
}): ProvisionModule[] {
  return [
    precheckModule,
    systemUpdateModule,
    sshHardeningModule(opts.publicKey),
    ufwModule([80, 443]),
    autoDefenseModule,
    dockerModule,
    traefikModule(opts.acmeEmail),
  ];
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test pnpm test provision.pipeline`
Expected: PASS.

- [ ] **Step 5: Kuyruk + processor + controller yaz**

`apps/api/src/queue/queue.module.ts` (BullMQ bağlantısı, `provision` kuyruğu):

```ts
import { Module } from "@nestjs/common";
import { Queue } from "bullmq";

export const PROVISION_QUEUE = "provision";

export const provisionQueueProvider = {
  provide: PROVISION_QUEUE,
  useFactory: () =>
    new Queue(PROVISION_QUEUE, {
      connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    }),
};

@Module({
  providers: [provisionQueueProvider],
  exports: [provisionQueueProvider],
})
export class QueueModule {}
```

`apps/api/src/provision/provision.processor.ts` (Worker: server kimlik bilgisiyle SshRunner kurar, pipeline koşar, ProvisionRun yazar):

```ts
import { Worker } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SshRunner } from "./ssh-runner.js";
import { runPipeline } from "./module.js";
import { buildModules } from "./provision.pipeline.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

export function startProvisionWorker(getCreds: (serverId: string) => Promise<{
  host: string; user: string; port: number; privateKey: string;
}>, opts: { publicKey: string; acmeEmail: string }) {
  return new Worker(
    PROVISION_QUEUE,
    async (job) => {
      const { serverId } = job.data as { serverId: string };
      const creds = await getCreds(serverId);
      const runner = await SshRunner.connect({
        host: creds.host, port: creds.port, username: creds.user, privateKey: creds.privateKey,
      });
      try {
        await runPipeline(runner, buildModules(opts), async (step) => {
          await prisma.provisionRun.create({
            data: { serverId, step: step.id, status: step.status },
          });
        });
      } finally {
        runner.close();
      }
    },
    { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } },
  );
}
```

`apps/api/src/provision/provision.controller.ts` (tetikleme + ilerleme):

```ts
import { Controller, Get, Inject, Param, Post, HttpCode, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import { prisma } from "@deployhaven/db";
import { SessionGuard } from "../auth/session.guard.js";
import { PROVISION_QUEUE } from "../queue/queue.module.js";

@Controller("servers/:id/provision")
@UseGuards(SessionGuard)
export class ProvisionController {
  constructor(@Inject(PROVISION_QUEUE) private readonly queue: Queue) {}

  @Post()
  @HttpCode(202)
  async trigger(@Param("id") id: string) {
    const job = await this.queue.add("provision", { serverId: id });
    return { jobId: job.id };
  }

  @Get()
  async progress(@Param("id") id: string) {
    return prisma.provisionRun.findMany({
      where: { serverId: id },
      orderBy: { createdAt: "asc" },
    });
  }
}
```

`apps/api/src/provision/provision.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ProvisionController } from "./provision.controller.js";

@Module({
  imports: [QueueModule, AuthModule],
  controllers: [ProvisionController],
})
export class ProvisionModule {}
```

`app.module.ts` imports'a `ProvisionModule` ekle. Worker'ı `main.ts` bootstrap içinde `NODE_ENV !== "test"` iken başlat (test'te BullMQ/Redis bağlanmasın):

```ts
// main.ts bootstrap() içinde, app.listen'den önce:
if (process.env.NODE_ENV !== "test") {
  const { startProvisionWorker } = await import("./provision/provision.processor.js");
  const { ServersService } = await import("./servers/servers.service.js");
  const svc = app.get(ServersService);
  startProvisionWorker((serverId) => svc.getSshCredentials(serverId), {
    publicKey: process.env.PROVISION_PUBLIC_KEY ?? "",
    acmeEmail: process.env.ACME_EMAIL ?? "ops@example.com",
  });
}
```

`.env.example`'a `PROVISION_PUBLIC_KEY` ve `ACME_EMAIL` ekle.

- [ ] **Step 6: Bağımlılık kur + build doğrula**

Run: `pnpm add bullmq --filter @deployhaven/api && pnpm --filter @deployhaven/api build`
Expected: kurulum + build hatasız (worker test dışında yüklendiği için test'i etkilemez).

- [ ] **Step 7: Testleri çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm test`
Expected: tüm mevcut testler + provision.pipeline PASS (worker test ortamında başlatılmaz).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/queue apps/api/src/provision apps/api/src/app.module.ts apps/api/src/main.ts .env.example pnpm-lock.yaml
git commit -m "feat(provision): BullMQ kuyruğu, tetikleme endpoint'i ve provizyon worker"
```

---

### Task 14: İlerleme SSE akışı

**Files:**
- Modify: `apps/api/src/provision/provision.controller.ts`
- Create: `apps/api/test/provision.e2e.test.ts`

**Interfaces:**
- Consumes: `ProvisionController` (Task 13), `prisma` (ProvisionRun).
- Produces: `GET /servers/:id/provision/stream` (guarded, SSE) — `ProvisionRun` satırlarını periyodik yayınlar; `POST /servers/:id/provision` 202 ve `GET .../provision` liste. e2e test: sunucu oluştur → provizyon tetikle (202 + jobId) → ProvisionRun listesi endpoint'i 200 döner (kuyruk Redis'e bağlı; test yalnız HTTP sözleşmesini doğrular, worker'ı çalıştırmaz).

- [ ] **Step 1: Testi yaz (`provision.e2e.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "prov@dh.test";

describe("Provision tetikleme + ilerleme", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.9", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("provizyon tetikler (202 + jobId)", async () => {
    const res = await request(app.getHttpServer()).post(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
  });

  it("ilerleme listesi 200 döner (dizi)", async () => {
    const res = await request(app.getHttpServer()).get(`/servers/${serverId}/provision`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

Not: bu test Redis'in çalışıyor olmasını gerektirir (kuyruğa ekleme). Dev/CI'da Redis servis olarak ayakta.

- [ ] **Step 2: Testi çalıştır (başarısız/eksik SSE olabilir)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" REDIS_URL="redis://localhost:6379" pnpm test provision.e2e`
Expected: 202 + liste testleri geçer (SSE endpoint eklenince stream de eklenir).

- [ ] **Step 3: SSE endpoint ekle (`provision.controller.ts`)**

`@Sse` ile ekle (NestJS `@nestjs/common` `Sse`, `MessageEvent` + rxjs `interval`):

```ts
import { Sse, MessageEvent } from "@nestjs/common";
import { interval, switchMap, from, map } from "rxjs";

  @Sse("stream")
  stream(@Param("id") id: string) {
    return interval(2000).pipe(
      switchMap(() =>
        from(
          prisma.provisionRun.findMany({
            where: { serverId: id },
            orderBy: { createdAt: "asc" },
          }),
        ),
      ),
      map((rows): MessageEvent => ({ data: rows })),
    );
  }
```

- [ ] **Step 4: Testleri çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" REDIS_URL="redis://localhost:6379" pnpm test provision.e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/provision/provision.controller.ts apps/api/test/provision.e2e.test.ts
git commit -m "feat(provision): ilerleme listesi + SSE akış endpoint'i"
```

---

### Task 15: Agent enrollment (token + kayıt + heartbeat)

**Files:**
- Create: `apps/api/src/agent/agent.controller.ts`
- Create: `apps/api/src/agent/agent.service.ts`
- Create: `apps/api/src/agent/agent.module.ts`
- Modify: `packages/db/prisma/schema.prisma` (`Agent` modeli: id, serverId, tokenHash, lastSeenAt, status) + migration
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/agent/package.json`, `apps/agent/src/index.ts`
- Create: `apps/api/test/agent.e2e.test.ts`

**Interfaces:**
- Consumes: `prisma`, `SessionGuard`, `encryptSecret`/hash yardımcıları.
- Produces:
  - `POST /servers/:id/agent/enroll-token` (guarded) → `{ token }` (tek kullanımlık; hash'i `Agent.tokenHash` olarak saklanır).
  - `POST /agent/register` `{ token }` (guardsız, agent çağırır) → 200 `{ agentId }` (token hash eşleşirse); geçersiz token 401.
  - `POST /agent/heartbeat` header `x-agent-token` → 204 (`lastSeenAt` güncellenir, status `online`).
  - `apps/agent`: minimal Node servis; `DEPLOYHAVEN_API_URL` + `DEPLOYHAVEN_ENROLL_TOKEN` env ile açılışta `register`, sonra periyodik `heartbeat`.

- [ ] **Step 1: Şema + migration**

`schema.prisma`'ya ekle:

```prisma
model Agent {
  id         String   @id @default(cuid())
  serverId   String   @unique
  tokenHash  String   @unique
  status     String   @default("pending")
  lastSeenAt DateTime?
  createdAt  DateTime @default(now())
  server     Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
}
```

`Server` modeline `agent Agent?` ilişkisini ekle.

Run: `cd packages/db && DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm db:migrate --name agent_enrollment && pnpm db:generate`

- [ ] **Step 2: Testi yaz (`agent.e2e.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/main.js";
import { prisma } from "@deployhaven/db";

process.env.SECRET_KEY = randomBytes(32).toString("base64");
const email = "agent@dh.test";

describe("Agent enrollment", () => {
  let app: INestApplication;
  let cookie: string;
  let serverId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/auth/register").send({ email, password: "password123" });
    cookie = reg.headers["set-cookie"][0];
    const srv = await request(app.getHttpServer()).post("/servers").set("Cookie", cookie)
      .send({ name: "vps", host: "10.0.0.7", sshPrivateKey: "k" });
    serverId = srv.body.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("enroll token üretir, agent kaydolur, heartbeat 204", async () => {
    const tok = await request(app.getHttpServer())
      .post(`/servers/${serverId}/agent/enroll-token`).set("Cookie", cookie);
    expect(tok.status).toBe(201);
    const token = tok.body.token;
    expect(token).toBeTruthy();

    const reg = await request(app.getHttpServer()).post("/agent/register").send({ token });
    expect(reg.status).toBe(200);
    expect(reg.body.agentId).toBeTruthy();

    const hb = await request(app.getHttpServer()).post("/agent/heartbeat").set("x-agent-token", token);
    expect(hb.status).toBe(204);
  });

  it("geçersiz token register 401", async () => {
    const reg = await request(app.getHttpServer()).post("/agent/register").send({ token: "gecersiz" });
    expect(reg.status).toBe(401);
  });
});
```

- [ ] **Step 3: Testi çalıştır (başarısız olmalı)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm test agent.e2e`
Expected: FAIL.

- [ ] **Step 4: `agent.service.ts` yaz**

```ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@deployhaven/db";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AgentService {
  async issueToken(serverId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await prisma.agent.upsert({
      where: { serverId },
      create: { serverId, tokenHash: hash(token), status: "pending" },
      update: { tokenHash: hash(token), status: "pending" },
    });
    return token;
  }

  async register(token: string): Promise<string> {
    const agent = await prisma.agent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent) throw new UnauthorizedException("geçersiz token");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: "online", lastSeenAt: new Date() },
    });
    return agent.id;
  }

  async heartbeat(token: string): Promise<void> {
    const agent = await prisma.agent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent) throw new UnauthorizedException("geçersiz token");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: "online", lastSeenAt: new Date() },
    });
  }
}
```

- [ ] **Step 5: `agent.controller.ts` yaz**

```ts
import {
  Body, Controller, Headers, HttpCode, Param, Post, UseGuards, UnauthorizedException,
} from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { AgentService } from "./agent.service.js";

@Controller()
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Post("servers/:id/agent/enroll-token")
  @UseGuards(SessionGuard)
  @HttpCode(201)
  async token(@Param("id") id: string) {
    return { token: await this.agents.issueToken(id) };
  }

  @Post("agent/register")
  @HttpCode(200)
  async register(@Body() body: { token?: string }) {
    if (!body?.token) throw new UnauthorizedException();
    return { agentId: await this.agents.register(body.token) };
  }

  @Post("agent/heartbeat")
  @HttpCode(204)
  async heartbeat(@Headers("x-agent-token") token?: string) {
    if (!token) throw new UnauthorizedException();
    await this.agents.heartbeat(token);
  }
}
```

- [ ] **Step 6: `agent.module.ts` + `app.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({ imports: [AuthModule], controllers: [AgentController], providers: [AgentService] })
export class AgentModule {}
```

`app.module.ts` imports'a `AgentModule` ekle.

- [ ] **Step 7: `apps/agent` skeleton yaz**

`apps/agent/package.json`:

```json
{
  "name": "@deployhaven/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node src/index.js", "build": "echo 'no build (plain js)'", "test": "echo 'no tests'", "lint": "echo 'no lint'" }
}
```

`apps/agent/src/index.ts`:

```ts
const API = process.env.DEPLOYHAVEN_API_URL ?? "http://localhost:4000";
const TOKEN = process.env.DEPLOYHAVEN_ENROLL_TOKEN;

async function main() {
  if (!TOKEN) throw new Error("DEPLOYHAVEN_ENROLL_TOKEN gerekli");
  const reg = await fetch(`${API}/agent/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  if (!reg.ok) throw new Error(`register başarısız: ${reg.status}`);
  console.log("agent kaydoldu");

  setInterval(async () => {
    await fetch(`${API}/agent/heartbeat`, {
      method: "POST",
      headers: { "x-agent-token": TOKEN },
    }).catch(() => {});
  }, 30000);
}

void main();
```

- [ ] **Step 8: Testleri çalıştır (geçmeli)**

Run: `cd apps/api && NODE_ENV=test DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public" pnpm test agent.e2e`
Expected: PASS. Tüm suite'in hâlâ geçtiğini doğrula.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/agent apps/api/src/app.module.ts packages/db apps/agent apps/api/test/agent.e2e.test.ts
git commit -m "feat(agent): enrollment token, kayıt + heartbeat + agent skeleton"
```

---

### Task 16: Opt-in VM entegrasyon harness'i + docs

**Files:**
- Create: `scripts/vm-provision-check.sh`
- Create: `docs/provisioning-vm-test.md`

**Interfaces:**
- Consumes: `SshRunner` + `buildModules` (Task 12-13).
- Produces: manuel çalıştırılan bir betik: bir VM'in IP + SSH anahtarını alır, `buildModules` pipeline'ını gerçek SshRunner ile koşar, her adımı yazdırır; sonra idempotency doğrulaması için ikinci kez koşar (hepsi `skipped` olmalı). CI'da çalışmaz; docs kullanımını açıklar (multipass ya da geçici VPS).

- [ ] **Step 1: `docs/provisioning-vm-test.md` yaz**

```markdown
# Provizyon VM Testi (opt-in)

Provizyon modülleri birim testlerle (FakeRunner) CI'da doğrulanır. Gerçek uçtan
uca doğrulama için tek kullanımlık bir Ubuntu 22.04/24.04 VM kullanın (multipass
ya da geçici bir VPS). Bu test CI'da KOŞMAZ; canlı sunucularınıza (srv01/srv02)
karşı çalıştırmayın.

## Kullanım

1. Tek kullanımlık VM oluşturun (örn. `multipass launch 24.04 --name dh-test`).
2. VM'e SSH erişimi olan bir anahtar hazırlayın.
3. Çalıştırın:

   ```bash
   VM_HOST=<ip> VM_USER=ubuntu VM_KEY=~/.ssh/id_ed25519 \
   PROVISION_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" ACME_EMAIL=ops@example.com \
   ./scripts/vm-provision-check.sh
   ```

4. Betik pipeline'ı iki kez koşar; ikinci koşuda tüm adımlar `skipped` olmalı
   (idempotency kanıtı).
5. Bittiğinde VM'i silin (`multipass delete --purge dh-test`).
```

- [ ] **Step 2: `scripts/vm-provision-check.sh` yaz**

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${VM_HOST:?VM_HOST gerekli}" ; : "${VM_USER:?VM_USER gerekli}" ; : "${VM_KEY:?VM_KEY gerekli}"
: "${PROVISION_PUBLIC_KEY:?PROVISION_PUBLIC_KEY gerekli}" ; : "${ACME_EMAIL:?ACME_EMAIL gerekli}"

cd "$(dirname "$0")/../apps/api"
export VM_HOST VM_USER VM_KEY PROVISION_PUBLIC_KEY ACME_EMAIL
npx tsx -e '
import { readFileSync } from "node:fs";
import { SshRunner } from "./src/provision/ssh-runner.js";
import { runPipeline } from "./src/provision/module.js";
import { buildModules } from "./src/provision/provision.pipeline.js";
const mods = buildModules({ publicKey: process.env.PROVISION_PUBLIC_KEY, acmeEmail: process.env.ACME_EMAIL });
const cfg = { host: process.env.VM_HOST, port: 22, username: process.env.VM_USER, privateKey: readFileSync(process.env.VM_KEY, "utf8") };
for (const pass of [1, 2]) {
  const runner = await SshRunner.connect(cfg);
  const res = await runPipeline(runner, mods, (s) => console.log(`pass${pass} ${s.id}: ${s.status}${s.error ? " " + s.error : ""}`));
  runner.close();
  if (pass === 2 && res.some((r) => r.status === "done")) {
    console.error("IDEMPOTENCY HATASI: 2. koşuda done olan adım var"); process.exit(1);
  }
}
console.log("VM provizyon kontrolü: OK");
'
```

- [ ] **Step 3: Betiği çalıştırılabilir yap + söz dizimi doğrula**

Run: `chmod +x scripts/vm-provision-check.sh && bash -n scripts/vm-provision-check.sh`
Expected: söz dizimi hatası yok. (Gerçek VM çalıştırması manuel/opsiyonel; burada yalnız betik geçerliliği doğrulanır.)

- [ ] **Step 4: Commit**

```bash
git add scripts/vm-provision-check.sh docs/provisioning-vm-test.md
git commit -m "docs: opt-in VM provizyon entegrasyon harness'i"
```

---

## Self-Review Notları

- **Spec kapsamı (M1, §4.3):** precheck (T3), sistem güncelleme (T4), SSH sertleştirme + deploy user (T5), UFW (T6), fail2ban + unattended-upgrades (T7), Docker (T8), Traefik (T9), agent enrollment (T15). cloudflared kurulumu bilinçli olarak M4'e ertelendi (Cloudflare milestone'u); M1 çekirdek provizyon + sertleştirme + agent'a odaklı.
- **Test edilebilirlik:** tüm modüller `CommandRunner` arayüzüne bağımlı; birim testleri `FakeRunner` ile gerçek sunucu olmadan komut üretimi + idempotency `check()` mantığını doğrular. Gerçek uçtan uca T16 opt-in VM harness'inde.
- **Güvenlik:** SSH özel anahtarı AES-256-GCM ile şifreli (T10), yanıtta/loglarda görünmez; agent token'ı hash'li saklanır (M0 session desenini izler); en az yetki (deploy non-root, root login kapalı).
- **Redis ilk kullanımı:** BullMQ kuyruğu (T13); worker yalnız `NODE_ENV !== "test"` iken başlar, testler kuyruğa ekleme dışında Redis'e bağlanmaz (Redis dev/CI'da servis olarak ayakta).
- **Tip tutarlılığı:** `CommandRunner`/`ExecResult` her modülde aynı; `buildModules` sırası (T13) modül id'leriyle eşleşir; `getSshCredentials` (T11) worker'da (T13) tüketilir; `Agent.tokenHash` sha256 deseni M0 session token deseniyle aynı.
- **Kalite kapısı:** T5/T10/T11/T15 auth/secret/dışa açık yüzeye dokunur; milestone sonunda `security` denetimi + tüm branch `code-reviewer` gerekir (M0'daki gibi).
