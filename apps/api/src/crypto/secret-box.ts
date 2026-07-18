import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.SECRET_KEY;
  if (!raw) throw new Error("SECRET_KEY tanımlı değil");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("SECRET_KEY 32 bayt (base64) olmalı");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(cipher: string): string {
  const [ivB, tagB, encB] = cipher.split(":");
  if (!ivB || !tagB || !encB) throw new Error("geçersiz cipher formatı");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
