import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hash düz metinden farklıdır ve doğrulanır", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash).not.toBe("s3cret!");
    expect(await verifyPassword(hash, "s3cret!")).toBe(true);
  });

  it("yanlış parola doğrulanmaz", async () => {
    const hash = await hashPassword("s3cret!");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
