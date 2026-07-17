# Contributing to Deployhaven

Thanks for your interest in improving Deployhaven, an open source, Linux-first,
multi-server PaaS. This guide covers how to get a development environment running,
the conventions we follow, and what we expect in a pull request.

## Development environment

Deployhaven is a pnpm + Turborepo monorepo. You need Node 20+ and the pinned
pnpm version (`pnpm@9.12.0`, declared in the root `package.json`). Enabling
corepack (`corepack enable`) makes your local pnpm match CI exactly.

The full setup steps live in the [README](README.md). In short:

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres 16 + Redis 7
cp .env.example .env
cd packages/db && pnpm db:generate && pnpm db:migrate && cd ../..
pnpm dev
```

- API: http://localhost:4000
- Panel: http://localhost:3000

The dev Postgres is reachable at `localhost:5432` with database, user, and
password all set to `deployhaven`.

## Running tests

The single entrypoint that mirrors CI is:

```bash
./scripts/dev-check.sh
```

It generates and builds `@deployhaven/db` first (both the api and db suites
import it), then runs the db smoke suite and the api health/auth/password
suites (14 tests total). It requires the dev Postgres to be running and
reachable at `localhost:5432`.

You can also run a single package directly:

```bash
pnpm --filter @deployhaven/db test
pnpm --filter @deployhaven/api test
```

Please make sure `./scripts/dev-check.sh` passes before opening a pull request.

## Code style

- The codebase is TypeScript in strict mode. Do not weaken `strict`, and avoid
  `any` where a precise type is possible.
- Keep changes modular: single responsibility, clear layer separation
  (presentation, business logic, data access), no magic constants (use
  env/config), no god files.
- Match the surrounding patterns and naming. Look at neighboring files before
  introducing new conventions.
- Never commit secrets. Configuration goes through `.env` (see `.env.example`),
  not into source or logs.

## Branch and commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). The history
uses these types:

- `feat:` a new feature
- `fix:` a bug fix (use a scope for security fixes, e.g. `fix(security): ...`)
- `chore:` tooling, infra, or maintenance
- `docs:` documentation only

Optional scopes match the package or area, for example `feat(api):`,
`feat(db):`, `feat(panel):`, `fix(build):`.

Branch off `main` with a short descriptive name, for example
`feat/server-provisioning` or `fix/session-cookie`.

## Pull request expectations

- Keep pull requests focused. One logical change per PR.
- Fill in the PR template (summary, type of change, testing done, checklist).
- Confirm tests pass and that no secrets are committed.
- Update documentation when behavior or setup changes.

## Provisioning and security code

Deployhaven provisions and hardens real servers (SSH, firewall, Docker,
Cloudflare, self-host deploy). Any change to provisioning, hardening, auth,
session handling, or other security-sensitive code must be reviewed carefully
before merge. If you are unsure whether a change touches a security surface,
call it out in the PR description so a maintainer can review it with that lens.

If you believe you have found a security vulnerability, do not open a public
issue. Follow the process in [SECURITY.md](SECURITY.md) instead.
