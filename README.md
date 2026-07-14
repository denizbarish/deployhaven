# Deployhaven

Açık kaynak, Linux-first, çok-sunucu PaaS. Boş bir Ubuntu sunucusunu uçtan uca
provizyonlar (Docker + güvenlik sertleştirme + Cloudflare) ve kendi projeni
Git/Compose ile canlıya alır.

## Geliştirme

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env
cd packages/db && pnpm db:generate && pnpm db:migrate && cd ../..
pnpm dev
```

- API: http://localhost:4000
- Panel: http://localhost:3000

## Mimari

- `apps/api` — NestJS kontrol düzlemi + auth
- `apps/panel` — Next.js panel
- `packages/db` — Prisma şeması + client

Tasarım: `docs/superpowers/specs/2026-07-13-deployhaven-design.md`
