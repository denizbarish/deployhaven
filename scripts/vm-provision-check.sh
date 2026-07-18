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
  // Important #3: precheck yalnizca DOGRULAMA adimidir (OS/sudo kontrolu), durum
  // MUTASYONU yapmaz; check() daima false doner, bu yuzden her kosuda "done" raporlar.
  // Idempotency yalnizca durum degistiren adimlar icin anlamlidir: pass 2 icinde
  // "done" olan bir adim, step id degeri "precheck" DEGILSE idempotency ihlalidir.
  if (pass === 2 && res.some((r) => r.status === "done" && r.id !== "precheck")) {
    console.error("IDEMPOTENCY HATASI: 2. koşuda done olan adım var"); process.exit(1);
  }
}
console.log("VM provizyon kontrolü: OK");
'
