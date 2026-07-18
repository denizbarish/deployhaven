import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.SECRET_KEY = randomBytes(32).toString("base64");
});

describe("secret-box", () => {
  it("şifrele-çöz round-trip", async () => {
    const { encryptSecret, decryptSecret } = await import("./secret-box.js");
    const plain = "ssh-ed25519-private-key-material";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("bozuk cipher çözülünce hata", async () => {
    const { decryptSecret } = await import("./secret-box.js");
    expect(() => decryptSecret("bozuk")).toThrow();
  });
});
