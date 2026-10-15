import { createHash } from 'node:crypto';

// A bloom filter is a row of `bits` bits, all 0 at the start. To add a value,
// hash it `hashes` times and set those bits to 1. To check a value, look at
// the same bits:
//   - any bit is 0  -> the value was DEFINITELY never added
//   - all bits are 1 -> the value was PROBABLY added (other values may have
//                       set those same bits: a false positive)
// It can't list or delete values, but it answers in O(k) using ~10 bits per
// item, whatever the item's size.

// Optimal size for `capacity` items at a target false-positive rate:
//   bits   m = -n·ln(p) / (ln 2)²
//   hashes k = (m/n)·ln 2
export function bloomSize(capacity: number, falsePositiveRate: number) {
  const bits = Math.ceil(
    (-capacity * Math.log(falsePositiveRate)) / Math.LN2 ** 2,
  );
  const hashes = Math.max(1, Math.round((bits / capacity) * Math.LN2));
  return { bits, hashes };
}

// The false-positive rate to expect once `items` values are in the filter.
export function expectedFalsePositiveRate(
  bits: number,
  hashes: number,
  items: number,
) {
  return (1 - Math.exp((-hashes * items) / bits)) ** hashes;
}

// The bit positions for a value. Instead of k separate hash functions, one
// SHA-256 gives two 64-bit hashes h1, h2, and position i = h1 + i·h2 (mod m).
// (Kirsch & Mitzenmacher showed this is as good as k independent hashes.)
export function bloomPositions(
  value: string,
  bits: number,
  hashes: number,
): number[] {
  const digest = createHash('sha256').update(value).digest();
  const h1 = digest.readBigUInt64BE(0);
  const h2 = digest.readBigUInt64BE(8);
  const m = BigInt(bits);
  return Array.from({ length: hashes }, (_, i) =>
    Number((h1 + BigInt(i) * h2) % m),
  );
}
