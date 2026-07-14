import { ConflictException, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { prisma, Prisma, Role } from "@deployhaven/db";
import { hashPassword, verifyPassword } from "./password.js";

const DEFAULT_SESSION_TTL_HOURS = 168;

// SESSION_TTL_HOURS may be unset, malformed ("7h", ""), or absurd. Fall back to
// the default unless it parses to a finite, positive number.
function resolveSessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_HOURS;
  const hours = raw === undefined ? DEFAULT_SESSION_TTL_HOURS : Number(raw);
  const safeHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_TTL_HOURS;
  return safeHours * 60 * 60 * 1000;
}

const SESSION_TTL_MS = resolveSessionTtlMs();

// The cookie carries a high-entropy CSPRNG token; only its SHA-256 hash is
// persisted, so a DB read never yields a usable bearer credential.
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

@Injectable()
export class AuthService {
  async register(email: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("email already registered");

    const passwordHash = await hashPassword(password);
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, passwordHash } });
        const team = await tx.team.create({ data: { name: `${email}'s team` } });
        await tx.membership.create({
          data: { userId: user.id, teamId: team.id, role: Role.OWNER },
        });
        return { userId: user.id, teamId: team.id };
      });
    } catch (err) {
      // Race-safe path: a concurrent signup that slipped past the pre-check
      // hits the unique(email) constraint. Map P2002 to a clean 409.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("email already registered");
      }
      throw err;
    }
  }

  async validateUser(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const ok = await verifyPassword(user.passwordHash, password);
    return ok ? { id: user.id } : null;
  }

  // Returns the raw token (for the cookie) plus expiry; persists only the hash.
  async createSession(userId: string) {
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: { userId, tokenHash: hashToken(rawToken), expiresAt },
    });
    return { token: rawToken, expiresAt };
  }

  async getUserFromSession(rawToken: string) {
    if (!rawToken) return null;
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return { id: session.user.id, email: session.user.email };
  }

  // Idempotent logout: deletes the session row backing the presented cookie.
  async revokeSession(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(rawToken) },
    });
  }
}
