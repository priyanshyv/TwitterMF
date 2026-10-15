// Snowflake IDs (the scheme Twitter published in 2010). 64 bits, laid out as:
//
//   | 1 unused | 41 bits: ms since EPOCH | 10 bits: worker | 12 bits: sequence |
//
// - Unique without asking the database: each API instance has its own worker
//   ID, and within one millisecond the sequence counts 0..4095.
// - Sortable by time: newer IDs are bigger, so "ORDER BY id DESC" is "newest
//   first" and an ID works as a pagination cursor.
// - 41 bits of milliseconds last ~69 years from EPOCH.

export const EPOCH = 1767225600000n; // 2026-01-01T00:00:00Z
const WORKER_BITS = 10n;
const SEQUENCE_BITS = 12n;
export const MAX_WORKER_ID = (1n << WORKER_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095

export class Snowflake {
  private readonly workerId: bigint;
  private lastMs = -1n;
  private sequence = 0n;

  constructor(
    workerId: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(workerId) || workerId < 0 || workerId > MAX_WORKER_ID)
      throw new Error(`workerId must be an integer in 0..${MAX_WORKER_ID}`);
    this.workerId = BigInt(workerId);
  }

  next(): bigint {
    let ms = BigInt(this.now());

    if (ms < this.lastMs) {
      // The system clock moved backwards (e.g. an NTP correction). Issuing IDs
      // now could repeat ones we already handed out, so refuse instead.
      throw new Error(
        `Clock moved backwards by ${this.lastMs - ms}ms; refusing to generate IDs`,
      );
    }

    if (ms === this.lastMs) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      // 4096 IDs already issued this millisecond: wait for the next one.
      if (this.sequence === 0n) {
        while (ms <= this.lastMs) ms = BigInt(this.now());
      }
    } else {
      this.sequence = 0n;
    }

    this.lastMs = ms;
    return (
      ((ms - EPOCH) << (WORKER_BITS + SEQUENCE_BITS)) |
      (this.workerId << SEQUENCE_BITS) |
      this.sequence
    );
  }
}

// Splits an ID back into its parts; handy for debugging ("when was this
// tweet created?") without a database lookup.
export function decodeSnowflake(id: bigint) {
  return {
    timestamp: new Date(Number((id >> (WORKER_BITS + SEQUENCE_BITS)) + EPOCH)),
    workerId: Number((id >> SEQUENCE_BITS) & MAX_WORKER_ID),
    sequence: Number(id & MAX_SEQUENCE),
  };
}
