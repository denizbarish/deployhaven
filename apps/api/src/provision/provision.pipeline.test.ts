import { describe, it, expect } from "vitest";
import { buildModules } from "./provision.pipeline.js";

describe("buildModules", () => {
  it("doğru sırada beklenen modül id'lerini üretir", () => {
    const ids = buildModules({ publicKey: "ssh-ed25519 x", acmeEmail: "a@b.c" }).map((m) => m.id);
    expect(ids).toEqual([
      "precheck",
      "system-update",
      "ssh-hardening",
      "ufw",
      "auto-defense",
      "docker",
      "traefik",
    ]);
  });
});
