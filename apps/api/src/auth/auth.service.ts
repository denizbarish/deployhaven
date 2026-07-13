import { ConflictException, Injectable } from "@nestjs/common";
import { prisma, Role } from "@deployhaven/db";
import { hashPassword } from "./password.js";

const SESSION_TTL_MS =
  Number(process.env.SESSION_TTL_HOURS ?? 168) * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  async register(email: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("email already registered");

    const passwordHash = await hashPassword(password);
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash } });
      const team = await tx.team.create({ data: { name: `${email}'s team` } });
      await tx.membership.create({
        data: { userId: user.id, teamId: team.id, role: Role.OWNER },
      });
      return { userId: user.id, teamId: team.id };
    });
  }

  async createSession(userId: string) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    return prisma.session.create({ data: { userId, expiresAt } });
  }
}
