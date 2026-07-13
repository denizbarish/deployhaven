import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { CredentialsDto } from "./dto.js";
import { AuthService } from "./auth.service.js";

const COOKIE = process.env.SESSION_COOKIE_NAME ?? "dh_session";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @HttpCode(201)
  async register(
    @Body() body: CredentialsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(body.email, body.password);
    const session = await this.auth.createSession(result.userId);
    res.cookie(COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: session.expiresAt,
    });
    return result;
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: CredentialsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.validateUser(body.email, body.password);
    if (!user) throw new UnauthorizedException("invalid credentials");
    const session = await this.auth.createSession(user.id);
    res.cookie(COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: session.expiresAt,
    });
    return { userId: user.id };
  }
}
