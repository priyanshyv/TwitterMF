import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_COOKIE,
  type AuthedRequest,
  type AuthUser,
} from './auth.types.js';
import { TokensService } from './tokens.service.js';

const OPTIONAL_AUTH = 'optionalAuth';

// For routes anyone may call, where a logged-in viewer sees a bit more
// (e.g. "you follow this person").
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);

// Reads the access token from the cookie (browsers) or an
// `Authorization: Bearer` header (scripts, load tests) and attaches the user.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = req.cookies?.[ACCESS_COOKIE] ?? bearerToken(req);
    const user = token ? await this.tokens.verifyAccessToken(token) : null;

    if (user) req.user = user;
    else if (!optional) throw new UnauthorizedException('Not logged in');
    return true;
  }
}

function bearerToken(req: AuthedRequest) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
