import type { ProvisionModule } from "../module.js";

const DIR = "/opt/deployhaven/traefik";

function composeYml(): string {
  return `services:
  traefik:
    image: traefik:v3.1
    container_name: deployhaven-traefik
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.le.acme.tlschallenge=true"
      - "--certificatesresolvers.le.acme.email=\${ACME_EMAIL}"
      - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "letsencrypt:/letsencrypt"
    networks:
      - deployhaven
volumes:
  letsencrypt:
networks:
  deployhaven:
    external: true
`;
}

export function traefikModule(acmeEmail: string): ProvisionModule {
  return {
    id: "traefik",
    label: "Traefik reverse proxy",
    async check(runner) {
      const res = await runner.exec(
        "docker ps --filter name=deployhaven-traefik --filter status=running -q",
        { sudo: true },
      );
      return res.stdout.trim().length > 0;
    },
    async apply(runner) {
      await runner.exec(`mkdir -p ${DIR}`, { sudo: true });
      await runner.uploadFile(composeYml(), `${DIR}/docker-compose.yml`);
      await runner.uploadFile(`ACME_EMAIL=${acmeEmail}\n`, `${DIR}/.env`);
      await runner.exec("docker network create deployhaven || true", { sudo: true });
      await runner.exec(`docker compose -f ${DIR}/docker-compose.yml up -d`, { sudo: true });
    },
  };
}
