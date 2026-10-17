import { Global, Module } from '@nestjs/common';
import { BreakersService } from './breakers.service.js';

@Global()
@Module({ providers: [BreakersService], exports: [BreakersService] })
export class BreakersModule {}
