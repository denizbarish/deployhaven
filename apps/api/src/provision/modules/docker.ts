import type { ProvisionModule } from "../module.js";

const KEYRING = "/etc/apt/keyrings/docker.asc";
const LIST = "/etc/apt/sources.list.d/docker.list";

export const dockerModule: ProvisionModule = {
  id: "docker",
  label: "Docker Engine + Compose",
  async check(runner) {
    const res = await runner.exec("docker --version");
    return res.code === 0;
  },
  async apply(runner) {
    await runner.exec("install -m 0755 -d /etc/apt/keyrings", { sudo: true });
    await runner.exec(
      `curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o ${KEYRING}`,
      { sudo: true },
    );
    await runner.exec(`chmod a+r ${KEYRING}`, { sudo: true });
    await runner.exec(
      `bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=${KEYRING}] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > ${LIST}'`,
      { sudo: true },
    );
    await runner.exec("apt-get update", { sudo: true });
    await runner.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
      { sudo: true },
    );
    await runner.exec("usermod -aG docker deploy", { sudo: true });
    await runner.exec("systemctl enable --now docker", { sudo: true });
  },
};
