// Postgres error codes we react to. Drizzle wraps driver errors, so the code
// may sit on the error itself or on its `cause`.
export const PG_UNIQUE_VIOLATION = '23505';

export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}
