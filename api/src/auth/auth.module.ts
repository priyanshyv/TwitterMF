import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { TokensService } from './tokens.service.js';

// Global so any module can put @UseGuards(AuthGuard) on its routes.
@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [TokensService, AuthGuard],
  exports: [TokensService, AuthGuard],
})
export class AuthModule {}
