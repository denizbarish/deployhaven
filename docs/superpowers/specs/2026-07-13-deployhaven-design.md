# Deployhaven, Tasarım Dokümanı

**Tarih:** 2026-07-13
**Durum:** Taslak (onay bekliyor)
**Tür:** Açık kaynak, self-host odaklı PaaS

---

## 1. Özet

Deployhaven, geliştiricinin bomboş bir Ubuntu sunucusunu uçtan uca üretime hazırlayan
ve kendi projesini tek panelden canlıya almasını sağlayan açık kaynak, çok-sunucu bir
kontrol düzlemidir. Vaat net: **sunucu yönetim yükünü sıfırla.** Kullanıcı sunucu getirir;
Deployhaven Docker kurulumu, güvenlik sertleştirme, reverse proxy ve Cloudflare
entegrasyonunu otomatik yapar, ardından Git veya Docker Compose kaynağından deploy'u
üstlenir.

Konumlandırma: Coolify/Dokploy sınıfında modern PaaS, iki ayrışma ekseniyle:
1. **Uçtan uca provizyon + güvenlik sertleştirme baştan dahil** (opsiyonel eklenti değil).
2. **Cloudflare derin entegre** (Tunnel öncelikli, portsuz yayın).

## 2. Hedefler ve Hedef-Olmayanlar

### Hedefler (MVP)
- Boş Ubuntu (22.04/24.04) sunucuyu SSH ile agentless provizyonlama.
- Güvenlik sertleştirme: UFW firewall, SSH sertleştirme, fail2ban, otomatik güvenlik
  güncellemeleri (unattended-upgrades), Docker güvenli kurulum.
- Merkezi panelden çok sunucu yönetimi; her sunucuda hafif bir Node agent.
- İki deploy kaynağı: (a) Git repo bağla + otomatik build (Nixpacks/Dockerfile),
  (b) doğrudan Docker Compose.
- Otomatik TLS'li reverse proxy (Traefik veya Caddy).
- Cloudflare modülü: Tunnel, DNS kayıt yönetimi, proxy/SSL/WAF, Origin sertifikası +
  origin gizleme.
- Şifreli secrets yönetimi, temel RBAC.

### Hedef-Olmayanlar (MVP dışı, sonraya)
- Windows Server desteği (mimari provider soyutlamasıyla açık bırakılır, uygulanmaz).
- Hazır self-host uygulama kataloğu/mağazası (tık-kur app store).
- Kubernetes / çok-node orkestrasyon (tek sunucu = tek Docker host modeli).
- Fatura/ödeme, çok-kiracılı SaaS bulut sürümü.
- Yatay otomatik ölçekleme, blue-green/canary (sonraki fazlar).

## 3. Personalar
- **Solo geliştirici / indie hacker:** kendi SaaS'ını ucuz VPS'te güvenli yayınlamak ister,
  DevOps bilgisi sınırlı.
- **Küçük ekip:** birkaç sunucu, birkaç proje, ortak panel ve rol yönetimi ister.

## 4. Mimari

Hepsi TypeScript. Dört ana parça:

### 4.1 Panel (Frontend)
- Next.js (App Router) + Tailwind + shadcn/ui.
- Ekranlar: sunucular, projeler, deploylar, domainler, Cloudflare, loglar, secrets,
  ekip/roller, onboarding sihirbazı (sunucu ekle → provizyonla → ilk deploy).
- Gerçek zamanlı log/metrik akışı (WebSocket/SSE) kontrol düzlemi üzerinden.

### 4.2 Kontrol Düzlemi (Backend)
- NestJS API.
- Postgres (kalıcı durum: sunucular, projeler, deploylar, secrets, kullanıcılar).
- Redis + BullMQ (iş kuyruğu: provizyon adımları, build, deploy, Cloudflare çağrıları).
- Kimlik/yetki: oturum + RBAC (owner/admin/member).
- Secrets: uygulama katmanında şifreli saklama (libsodium/age); anahtar env'den.
- Panel ile agent arası: agent'a giden güvenli kanal (mTLS, aşağıda).

### 4.3 Provizyon (Agentless, ilk kurulum)
- SSH üzerinden (node-ssh / ssh2) idempotent modüller. Ansible bağımlılığı yok.
- Modüller (her biri tekrar çalıştırılabilir, durum kontrollü):
  1. Ön kontrol (OS/sürüm, kaynak, erişim).
  2. Sistem güncelleme + temel paketler.
  3. Kullanıcı/SSH sertleştirme (non-root deploy kullanıcısı, key-only, root login kapatma).
  4. Firewall (UFW: yalnız gerekli portlar; Cloudflare Tunnel'da 80/443 dahi kapalı).
  5. fail2ban + unattended-upgrades.
  6. Docker Engine + Compose plugin güvenli kurulum.
  7. Reverse proxy (Traefik/Caddy) konuşlandırma.
  8. Deployhaven agent kurulumu + kayıt (enrollment token ile).
  9. cloudflared (Tunnel seçiliyse).
- Her adım panelde canlı ilerleme + hata durumunda güvenli tekrar.

### 4.4 Agent (Her sunucuda, kalıcı)
- Node servis (systemd). MVP'de Node runtime; ileride tek binary (Bun/pkg compile).
- Görevleri: deploy yürütme, container yaşam döngüsü, canlı metrik (CPU/RAM/disk),
  log akışı, sağlık kontrolü, kontrol düzleminden komut alma.
- Güvenlik: kontrol düzlemine giden dışa-bağlantı (outbound) tercih edilir; enrollment
  token ile kayıt, sonrasında mTLS sertifika. Sunucuda açık gelen port gerektirmez.

### 4.5 Deploy Hattı
- **Git kaynağı:** GitHub/GitLab webhook → kuyruk → build (Dockerfile varsa o, yoksa
  Nixpacks) → imaj → agent'a deploy → proxy route + TLS → sağlık kontrolü.
- **Compose kaynağı:** kullanıcının compose'u alınır, secrets enjekte edilir, agent
  `docker compose up` yürütür, proxy'ye bağlanır.
- Rollback: önceki imaj/sürüm etiketiyle geri alma (MVP'de temel sürüm geçmişi).

### 4.6 Cloudflare Modülü
- Cloudflare API token ile:
  - **Tunnel (öncelik):** cloudflared yapılandırması, hostname → local servis eşleme,
    portsuz yayın (origin firewall tamamen kapalı).
  - **DNS:** A/CNAME kayıtlarını panelden oluştur/güncelle.
  - **Proxy/SSL/WAF:** turuncu bulut, SSL modu, temel rate-limit/WAF kuralları.
  - **Origin gizleme:** Origin sertifikası üret, sunucuyu yalnız Cloudflare IP aralığına aç
    (Tunnel kullanılmayan senaryoda).

## 5. Veri Modeli (taslak)
`User`, `Team`, `Membership(role)`, `Server`, `ProvisionRun(step,status)`, `Project`,
`Deployment(source,status,image)`, `Domain`, `CloudflareAccount`, `Secret(encrypted)`,
`AuditLog`.

## 6. Güvenlik İlkeleri (baştan, sonradan değil)
- Secrets her zaman şifreli (at rest); panelde maskeli.
- Agent ↔ kontrol düzlemi mTLS; enrollment token tek kullanımlık.
- En az yetki: provizyon deploy kullanıcısı non-root, sudo yalnız gerekli komutlara.
- Dış yüzey minimum: Tunnel modunda sunucuda gelen port yok.
- Denetim günlüğü (audit log) tüm kritik eylemlerde.
- Güvenlik, kod üreten her iş sonunda `security` + `code-reviewer` kalite kapısından geçer.

## 7. Teknoloji Yığını
- Panel: Next.js (App Router), TypeScript, Tailwind, shadcn/ui.
- Backend: NestJS, TypeScript, Postgres, Redis + BullMQ.
- Provizyon: ssh2/node-ssh, idempotent TS modülleri.
- Agent: Node + systemd (ileride tek binary).
- Build: Nixpacks + Docker.
- Proxy: Traefik veya Caddy (karar netleştirilecek, bkz. Açık Sorular).
- Dağıtım: monorepo (pnpm/turborepo); tüm bileşenler Docker'lı (dockerize varsayılan).

## 8. Sürümleme / Kilometre Taşları
1. **M0 – İskelet:** monorepo, panel+API iskeleti, auth, Postgres şeması, Docker compose dev.
2. **M1 – Provizyon:** SSH modülleri + sertleştirme + Docker kurulumu + agent enrollment.
3. **M2 – Deploy (Compose):** Compose kaynağından deploy + proxy + TLS + loglar.
4. **M3 – Deploy (Git):** webhook + Nixpacks/Dockerfile build + rollback.
5. **M4 – Cloudflare:** Tunnel + DNS + proxy/WAF + origin gizleme.
6. **M5 – Sertleştirme & sürüm:** RBAC, audit log, güvenlik denetimi, açık kaynak sürüm 0.1.

## 9. Açık Sorular
- Reverse proxy: Traefik mi Caddy mi? (Traefik = Docker-native etiket keşfi; Caddy = daha
  basit TLS. M2 öncesi karar.)
- Build motoru: Nixpacks yeterli mi, buildpacks alternatifi gerekli mi?
- Agent'ın tek binary'ye geçiş fazı (Bun compile) hangi milestone'da?
- Domain: `deployhaven.com` / `.dev` müsaitliği (kullanıcı doğrulayacak).

## 10. Karar Kaydı (bu oturumda kesinleşen)
- Çekirdek model: **hibrit** (dışarıdan provizyon + on-server panel/agent).
- İş yükü: geliştiricinin **kendi projesini** deploy (katalog değil).
- OS: **Linux-first**, Windows sonraya (provider soyutlaması).
- Deploy kaynağı: **Git + Compose** ikisi.
- Cloudflare: **tam kapsam** (Tunnel + DNS + proxy/WAF + origin gizleme).
- Kontrol düzlemi: **merkezi, çok sunucu, agent tabanlı**.
- Stack: **tam TypeScript** (A yaklaşımı).
- İsim: **Deployhaven** (npm + GitHub org `deployhaven` boş, doğrulandı).
