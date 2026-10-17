import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { ALLOWED_TYPES, MAX_BYTES, MediaService } from './media.service.js';

const UploadSchema = z.object({
  contentType: z.enum(ALLOWED_TYPES, 'Use a JPEG, PNG, WebP or GIF image'),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_BYTES, `Images can be at most ${MAX_BYTES / 1024 / 1024} MB`),
});
const MediaId = new ZodPipe(
  z
    .string()
    .regex(/^\d{1,20}$/, 'Must be a media ID')
    .transform((v) => BigInt(v)),
);

@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('uploads')
  @RateLimit('upload')
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(UploadSchema)) body: z.infer<typeof UploadSchema>,
  ) {
    return this.media.createUpload(user.id, body.contentType, body.bytes);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', MediaId) id: bigint) {
    return this.media.complete(user.id, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', MediaId) id: bigint) {
    return this.media.get(user.id, id);
  }
}
