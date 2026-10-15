import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

// Validates and parses request input with a zod schema. Bad input never
// reaches a service; the client gets a 400 naming each problem.
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid input',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
