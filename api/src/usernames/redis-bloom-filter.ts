import type { Redis } from 'ioredis';
import { bloomPositions } from './bloom.js';

// The bit array lives in one Redis string, so every API instance shares it.
// SETBIT/GETBIT address single bits; a pipeline sends all k of them in one
// round trip.
export class RedisBloomFilter {
  constructor(
    private readonly redis: Redis,
    readonly key: string,
    readonly bits: number,
    readonly hashes: number,
  ) {}

  async add(value: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const p of bloomPositions(value, this.bits, this.hashes))
      pipeline.setbit(this.key, p, 1);
    await pipeline.exec();
  }

  async addMany(values: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const value of values)
      for (const p of bloomPositions(value, this.bits, this.hashes))
        pipeline.setbit(this.key, p, 1);
    await pipeline.exec();
  }

  async mightContain(value: string): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    for (const p of bloomPositions(value, this.bits, this.hashes))
      pipeline.getbit(this.key, p);
    const results = (await pipeline.exec()) ?? [];
    return results.every(([err, bit]) => {
      if (err) throw err;
      return bit === 1;
    });
  }

  async exists(): Promise<boolean> {
    return (await this.redis.exists(this.key)) === 1;
  }
}
