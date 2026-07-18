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
