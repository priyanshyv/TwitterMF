import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodPipe } from '../common/zod.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { toPublicUser } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { clearAuthCookies, setAuthCookies } from './auth.cookies.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import {
  LoginSchema,
  SignupSchema,
  type LoginInput,
  type SignupInput,
} from './auth.schemas.js';
import {
  REFRESH_COOKIE,
  type AuthedRequest,
  type AuthUser,
} from './auth.types.js';
import {
  burnPasswordCheck,
  hashPassword,
  verifyPassword,
} from './passwords.js';
import { TokensService } from './tokens.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TokensService) private readonly tokens: TokensService,
  ) {}

  @Post('signup')
  async signup(
    @Body(new ZodPipe(SignupSchema)) body: SignupInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.users.create({
      username: body.username,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
    });
    await this.startSession(reply, user);
    return { user: toPublicUser(user) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.users.findByUsername(body.username);
    const valid = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await burnPasswordCheck(body.password).then(() => false);
    // One message for both cases: don't confirm which part was wrong.
    if (!user || !valid)
      throw new UnauthorizedException('Wrong username or password');

    await this.startSession(reply, user);
    return { user: toPublicUser(user) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    const result = raw ? await this.tokens.rotate(raw) : null;
    if (!result?.ok) {
      clearAuthCookies(reply, this.env);
      throw new UnauthorizedException(
        result?.reason === 'reused'
          ? 'Session ended for safety: this login was used from somewhere else'
          : 'Session expired, log in again',
      );
    }

    const user = await this.users.findById(result.userId);
    if (!user) throw new UnauthorizedException('Account no longer exists');
    setAuthCookies(reply, this.env, {
      accessToken: await this.tokens.signAccessToken(user),
      refreshToken: result.refreshToken,
    });
    return { user: toPublicUser(user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.tokens.revokeFamilyOf(raw);
    clearAuthCookies(reply, this.env);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.users.findById(authUser.id);
    if (!user) throw new NotFoundException('Account no longer exists');
    return { user: toPublicUser(user) };
  }

  private async startSession(
    reply: FastifyReply,
    user: { id: bigint; username: string },
  ) {
    setAuthCookies(reply, this.env, {
      accessToken: await this.tokens.signAccessToken(user),
      refreshToken: await this.tokens.issueRefreshToken(user.id),
    });
  }
}
