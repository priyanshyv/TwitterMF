import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [SearchModule], controllers: [HealthController] })
export class HealthModule {}
