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
