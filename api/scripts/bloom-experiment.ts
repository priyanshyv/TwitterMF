// Bloom filter lab: does the math match reality?
// Run from the repo root:  npm run lab:bloom
// Uses Redis DB 2 (your app data in DB 0 is untouched) and cleans up after.
import { Redis } from 'ioredis';
import {
  bloomSize,
  expectedFalsePositiveRate,
} from '../src/usernames/bloom.js';
import { RedisBloomFilter } from '../src/usernames/redis-bloom-filter.js';

const redis = new Redis('redis://localhost:6379/2');
const N = 100_000; // usernames we insert
const PROBES = 100_000; // names we never inserted, to count false positives
const CHUNK = 2_000;

const inserted = Array.from({ length: N }, (_, i) => `user_${i}_${rand()}`);
const neverInserted = Array.from(
  { length: PROBES },
  (_, i) => `probe_${i}_${rand()}`,
);

function rand() {
  return Math.random().toString(36).slice(2, 8);
}
function chunks<T>(items: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK)
    out.push(items.slice(i, i + CHUNK));
  return out;
}
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

async function ourFilter(
  label: string,
  sizedFor: number,
  rate: number,
  fillWith: string[],
) {
  const { bits, hashes } = bloomSize(sizedFor, rate);
  const filter = new RedisBloomFilter(redis, `lab:${label}`, bits, hashes);
  const started = performance.now();
  for (const c of chunks(fillWith)) await filter.addMany(c);
  const addMs = performance.now() - started;

  let falsePositives = 0;
  for (const name of neverInserted.slice(0, 20_000))
    if (await filter.mightContain(name)) falsePositives++;
  for (const name of inserted.slice(0, 1_000))
    if (!(await filter.mightContain(name))) throw new Error('false negative!');

  return {
    filter: label,
    'items / capacity': `${fillWith.length / 1000}k / ${sizedFor / 1000}k`,
    size: kb(bits / 8),
    'k hashes': hashes,
    expected: pct(expectedFalsePositiveRate(bits, hashes, fillWith.length)),
    measured: pct(falsePositives / 20_000),
    'add 1k (ms)': ((addMs / fillWith.length) * 1000).toFixed(1),
  };
}

async function redisBloom(rate: number) {
  const key = 'lab:redisbloom';
  await redis.call('BF.RESERVE', key, String(rate), String(N));
  const started = performance.now();
  for (const c of chunks(inserted)) await redis.call('BF.MADD', key, ...c);
  const addMs = performance.now() - started;

  let falsePositives = 0;
  for (const c of chunks(neverInserted)) {
    const hits = (await redis.call('BF.MEXISTS', key, ...c)) as number[];
    falsePositives += hits.filter((h) => h === 1).length;
  }
  const bytes = Number(await redis.call('MEMORY', 'USAGE', key));
  return {
    filter: `Redis 8 BF.* (${pct(rate)})`,
    'items / capacity': `${N / 1000}k / ${N / 1000}k`,
    size: kb(bytes),
    'k hashes': '-',
    expected: pct(rate),
    measured: pct(falsePositives / PROBES),
    'add 1k (ms)': ((addMs / N) * 1000).toFixed(1),
  };
}

async function main() {
  await redis.flushdb();
  console.log(
    `Inserting ${N / 1000}k usernames, then probing 20k names that were never added.\n`,
  );
  const rows = [
    await ourFilter('ours @ 10%', N, 0.1, inserted),
    await ourFilter('ours @ 1%', N, 0.01, inserted),
    await ourFilter('ours @ 0.1%', N, 0.001, inserted),
    // Same 1% filter, but stuffed with 3x the items it was sized for.
    await ourFilter('ours @ 1%, overfilled', N, 0.01, [
      ...inserted,
      ...inserted.map((n) => `${n}_b`),
      ...inserted.map((n) => `${n}_c`),
    ]),
    await redisBloom(0.01),
  ];
  console.table(rows);
  console.log(
    '\nFor comparison: storing 100k usernames as a Redis SET takes ' +
      (await setSize()) +
      '. The 1% filter answers the same "is it taken?" question in a fraction of that.',
  );
  await redis.flushdb();
  await redis.quit();
}

async function setSize() {
  for (const c of chunks(inserted)) await redis.sadd('lab:set', ...c);
  return kb(Number(await redis.call('MEMORY', 'USAGE', 'lab:set')));
}

await main();
