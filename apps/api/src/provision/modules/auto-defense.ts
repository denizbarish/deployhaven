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
