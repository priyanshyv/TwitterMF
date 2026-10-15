import { z } from 'zod';

// Cursor pagination: the client sends the last ID it saw, we return what comes
// after it. Unlike OFFSET (which re-reads and throws away every skipped row),
// "id < cursor" jumps straight there through the index, so page 1,000 costs
// the same as page 1. New tweets arriving meanwhile can't shift the pages.
export const PageQuerySchema = z.object({
  before: z
    .string()
    .regex(/^\d+$/, 'Must be a tweet ID')
    .transform((v) => BigInt(v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Page<T> {
  items: T[];
  // Pass as `before` to get the next page; null when there is none.
  nextCursor: string | null;
}

// Queries fetch limit + 1 rows: if the extra row exists there is another
// page, and we learn that without a second query.
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].id : null,
  };
}
