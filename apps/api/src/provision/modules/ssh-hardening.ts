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
