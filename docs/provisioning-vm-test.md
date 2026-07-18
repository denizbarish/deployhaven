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
