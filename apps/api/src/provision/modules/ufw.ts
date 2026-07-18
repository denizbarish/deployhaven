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
