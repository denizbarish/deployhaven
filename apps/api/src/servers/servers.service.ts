import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@deployhaven/db";
import { encryptSecret, decryptSecret } from "../crypto/secret-box.js";
import type { CreateServerDto } from "./dto.js";

@Injectable()
export class ServersService {
  private async teamIdFor(userId: string): Promise<string> {
    const m = await prisma.membership.findFirst({ where: { userId } });
    if (!m) throw new ForbiddenException("takım yok");
    return m.teamId;
  }

  async create(userId: string, dto: CreateServerDto) {
    const teamId = await this.teamIdFor(userId);
    const server = await prisma.server.create({
      data: {
        name: dto.name,
        host: dto.host,
        sshUser: dto.sshUser ?? "root",
        sshPort: dto.sshPort ?? 22,
        sshKeyCipher: encryptSecret(dto.sshPrivateKey),
        teamId,
      },
    });
    return { id: server.id };
  }

  async list(userId: string) {
    const teamId = await this.teamIdFor(userId);
    return prisma.server.findMany({
      where: { teamId },
      select: { id: true, name: true, host: true, sshUser: true, sshPort: true, createdAt: true },
    });
  }

  async getSshCredentials(serverId: string) {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server?.sshKeyCipher) throw new NotFoundException("sunucu/kimlik yok");
    return {
      host: server.host,
      user: server.sshUser,
      port: server.sshPort,
      privateKey: decryptSecret(server.sshKeyCipher),
    };
  }
}
