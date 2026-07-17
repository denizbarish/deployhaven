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
