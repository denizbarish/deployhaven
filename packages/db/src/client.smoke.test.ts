import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./index.js";

describe("prisma client", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: "smoke@dh.test" } });
    await prisma.$disconnect();
  });

  it("bir User oluşturup okur", async () => {
    const created = await prisma.user.create({
      data: { email: "smoke@dh.test", passwordHash: "x" },
    });
    const found = await prisma.user.findUnique({ where: { id: created.id } });
    expect(found?.email).toBe("smoke@dh.test");
  });
});
