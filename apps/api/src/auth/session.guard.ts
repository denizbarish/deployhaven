import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";

const COOKIE = process.env.SESSION_COOKIE_NAME ?? "dh_session";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const sessionId = req.cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException();
    const user = await this.auth.getUserFromSession(sessionId);
    if (!user) throw new UnauthorizedException();
    req.userId = user.id;
    return true;
  }
}
