import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  buildRemoteCommand,
  computeHostKeyFingerprint,
  verifyHostKey,
} from "./ssh-runner.js";

describe("SshRunner komut formatı", () => {
  it("sudo bayrağı 'sudo -n' öneki ekler", () => {
    expect(buildRemoteCommand("apt-get update", { sudo: true })).toBe("sudo -n apt-get update");
  });
  it("sudo yoksa komut aynen kalır", () => {
    expect(buildRemoteCommand("whoami")).toBe("whoami");
  });
});

describe("computeHostKeyFingerprint", () => {
  it("host anahtarının SHA-256 hex özetini üretir", () => {
    const key = Buffer.from("ornek-host-key");
    const expected = createHash("sha256").update(key).digest("hex");
    expect(computeHostKeyFingerprint(key)).toBe(expected);
  });
});

describe("verifyHostKey (FIND-001 TOFU + pinning)", () => {
  const fp = "a".repeat(64);

  it("eşleşen fingerprint kabul edilir", () => {
    expect(verifyHostKey(fp, fp)).toBe(true);
  });

  it("uyuşmayan fingerprint reddedilir", () => {
    expect(verifyHostKey(fp, "b".repeat(64))).toBe(false);
  });

  it("farklı uzunlukta fingerprint reddedilir (timingSafe çökmez)", () => {
    expect(verifyHostKey(fp, "b".repeat(40))).toBe(false);
  });

  it("beklenen fingerprint yoksa (TOFU) kabul edilir", () => {
    expect(verifyHostKey(fp, null)).toBe(true);
    expect(verifyHostKey(fp, undefined)).toBe(true);
    expect(verifyHostKey(fp, "")).toBe(true);
  });
});
