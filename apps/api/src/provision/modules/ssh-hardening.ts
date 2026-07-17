import type { ProvisionModule } from "../module.js";

const DROPIN = "/etc/ssh/sshd_config.d/deployhaven.conf";
const HARDENING = "PermitRootLogin no\nPasswordAuthentication no\n";
const AUTHORIZED_KEYS = "/home/deploy/.ssh/authorized_keys";

/** Tek satırlık, opsiyon içermeyen geçerli bir SSH açık anahtarı deseni. */
const PUBLIC_KEY_PATTERN =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)\s+[A-Za-z0-9+/=]+(\s+\S+)?$/;

/**
 * publicKey'i authorized_keys'e yazmadan önce doğrular (FIND-006, içerik enjeksiyonu).
 * Tek satır olmalı (gömülü newline/CR yasak) ve bilinen bir anahtar formatına uymalı;
 * böylece `command=`/`from=` gibi opsiyonlar veya ek anahtarlar enjekte edilemez.
 */
export function assertValidPublicKey(publicKey: string): void {
  const key = publicKey.trim();
  if (!key) throw new Error("PROVISION_PUBLIC_KEY boş: deploy anahtarı zorunlu");
  if (/[\r\n]/.test(publicKey)) {
    throw new Error("publicKey geçersiz: satır sonu (newline/CR) içeremez");
  }
  if (!PUBLIC_KEY_PATTERN.test(key)) {
    throw new Error("publicKey geçersiz: beklenen SSH açık anahtar formatına uymuyor");
  }
}

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
      // FIND-006: içeriği yazmadan önce doğrula.
      assertValidPublicKey(publicKey);

      // 1) deploy kullanıcısı + authorized_keys önce oluşturulur.
      await runner.exec("useradd -m -s /bin/bash -G sudo deploy || true", { sudo: true });
      await runner.exec("mkdir -p /home/deploy/.ssh", { sudo: true });
      await runner.uploadFile(publicKey.trim() + "\n", AUTHORIZED_KEYS, { mode: "600" });
      await runner.exec("chown -R deploy:deploy /home/deploy/.ssh", { sudo: true });
      await runner.exec("chmod 700 /home/deploy/.ssh", { sudo: true });

      // 2) FIND-005 (fail-closed): password auth kapatılmadan ÖNCE deploy anahtar
      // yolunun kullanılabilir olduğunu doğrula. authorized_keys boş olmamalı ve deploy'a
      // ait olmalı, sshd config sözdizimi geçerli olmalı. Aksi halde throw et; drop-in
      // yazılmaz, böylece geri-dönüşsüz lockout önlenir.
      const keyCheck = await runner.exec(
        `test -s ${AUTHORIZED_KEYS} && test "$(stat -c '%U' ${AUTHORIZED_KEYS})" = deploy`,
        { sudo: true },
      );
      if (keyCheck.code !== 0) {
        throw new Error(
          "deploy anahtar doğrulaması başarısız: authorized_keys boş veya sahiplik hatalı; " +
            "password auth kapatılmadı (lockout önlendi)",
        );
      }
      const preTest = await runner.exec("sshd -t", { sudo: true });
      if (preTest.code !== 0) {
        throw new Error(
          `sshd config geçersiz (sertleştirme öncesi): ${preTest.stderr}; password auth kapatılmadı`,
        );
      }

      // 3) Doğrulama geçti: sertleştirmeyi uygula (root login off, password auth off).
      await runner.uploadFile(HARDENING, DROPIN, { mode: "644" });
      const test = await runner.exec("sshd -t", { sudo: true });
      if (test.code !== 0) throw new Error(`sshd config geçersiz: ${test.stderr}`);
      await runner.exec("systemctl reload ssh", { sudo: true });
    },
  };
}
