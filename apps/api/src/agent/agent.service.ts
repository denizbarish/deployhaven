import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@deployhaven/db";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AgentService {
  async issueToken(serverId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await prisma.agent.upsert({
      where: { serverId },
      create: { serverId, tokenHash: hash(token), status: "pending" },
      update: { tokenHash: hash(token), status: "pending" },
    });
    return token;
  }

  async register(token: string): Promise<string> {
    const agent = await prisma.agent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent) throw new UnauthorizedException("geçersiz token");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: "online", lastSeenAt: new Date() },
    });
    return agent.id;
  }

  async heartbeat(token: string): Promise<void> {
    const agent = await prisma.agent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent) throw new UnauthorizedException("geçersiz token");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: "online", lastSeenAt: new Date() },
    });
  }
}
