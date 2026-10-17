import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaProcessor } from './media.processor.js';
import { MediaService } from './media.service.js';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaProcessor],
  exports: [MediaService, MediaProcessor],
})
export class MediaModule {}
