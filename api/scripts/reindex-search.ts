// Rebuilds the Meilisearch indexes and trending hashtags from Postgres.
// Run from the repo root:  npm run search:reindex
// Search data is a derived copy, so this is always safe: after Meilisearch
// lost its data, after changing index settings, or after seeding.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { SearchService } from '../src/search/search.service.js';
import { TrendsService } from '../src/search/trends.service.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const started = performance.now();
const counts = await app.get(SearchService).reindexAll();
const recent = await app.get(TrendsService).rebuild();
console.log(
  `Indexed ${counts.tweets} tweets and ${counts.users} users; trending rebuilt from ${recent} recent tweets ` +
    `(${Math.round(performance.now() - started)} ms).`,
);
await app.close();
