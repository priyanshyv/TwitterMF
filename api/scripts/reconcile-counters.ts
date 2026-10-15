// Recomputes every stored count (likes, replies, retweets, followers,
// following, tweets) from the rows they summarize.
// Run from the repo root:  npm run counters:reconcile
// For repairs, e.g. after Redis lost pending changes. Best run when quiet.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { CountersService } from '../src/counters/counters.service.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const started = performance.now();
await app.get(CountersService).reconcile();
console.log(
  `Counts recomputed in ${Math.round(performance.now() - started)} ms.`,
);
await app.close();
