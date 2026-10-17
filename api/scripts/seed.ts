// Fills the dev database with a small, believable network to play with.
//   npm run db:seed              adds ~60 people next to any existing accounts
//   npm run db:seed -- --reset   wipes ALL data first, including your own
//
// Every seeded account's password is "password123". Log in as @demo.
// Existing accounts are kept, and get some follows so their timelines fill.
//
// It boots the real app's services (without the HTTP server), so IDs come
// from the real Snowflake generator, counts from the real reconcile, and
// the bloom filter from the real rebuild.
import 'reflect-metadata';
import { faker } from '@faker-js/faker';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/passwords.js';
import { Snowflake } from '../src/common/snowflake.js';
import { ENV } from '../src/config/config.module.js';
import type { Env } from '../src/config/env.js';
import { CountersService } from '../src/counters/counters.service.js';
import { DB, type Database } from '../src/db/db.module.js';
import { follows, likes, tweets, users } from '../src/db/schema/index.js';
import { REDIS } from '../src/redis/redis.module.js';
import { UsernamesService } from '../src/usernames/usernames.service.js';

const USERS = 60;
const CELEBRITIES = 3; // followed by most people, tweet a lot
const TWEETS = 1_200;
const REPLY_SHARE = 0.25;
const RETWEETS = 300;
const LIKES = 6_000;
const DAYS = 30;
const PASSWORD = 'password123';
const DAY_MS = 24 * 60 * 60 * 1000;

type SeedUser = { id: bigint; username: string; celebrity: boolean };
type SeedTweet = {
  id?: bigint;
  authorId: bigint;
  at: number;
  text: string;
  replyTo?: SeedTweet;
  retweetOf?: SeedTweet;
  popularity: number; // how likely others are to like or retweet it
};

const reset = process.argv.includes('--reset');
faker.seed(42); // same data every run

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const db = app.get<Database>(DB);
const redis = app.get<Redis>(REDIS);
if (app.get<Env>(ENV).NODE_ENV === 'production')
  fail('Refusing to seed a production database.');

const { rows: existing } = await db.execute<{ id: string; username: string }>(
  sql`select id, username from users`,
);
if (!reset && existing.some((u) => u.username.toLowerCase() === 'demo'))
  fail(
    'Already seeded (@demo exists). Run "npm run db:seed -- --reset" to wipe everything and seed again.',
  );
if (reset) {
  console.log('Wiping all data…');
  await db.execute(
    sql`truncate users, tweets, follows, likes, refresh_tokens, notifications, outbox, media cascade`,
  );
}
// Everything in Redis is derived (caches, pending counts, the bloom filter,
// rate limits), so it can always be dropped and rebuilt.
await redis.flushdb();

const now = Date.now();
// Worker 1023 is reserved for scripts. The injected clock lets each ID
// carry its own event's timestamp; events must be passed in time order.
let clock = 0;
const snowflake = new Snowflake(1023, () => clock);
const idAt = (ms: number) => {
  clock = Math.max(clock, Math.floor(ms));
  return snowflake.next();
};

// ---- Users -----------------------------------------------------------------
console.log(`Creating ${USERS} users…`);
const passwordHash = await hashPassword(PASSWORD); // one slow hash, reused
const yours: SeedUser[] = reset
  ? []
  : existing.map((u) => ({
      id: BigInt(u.id),
      username: u.username,
      celebrity: false,
    }));
const taken = new Set(yours.map((u) => u.username.toLowerCase()));
const people: SeedUser[] = [];
const userRows: (typeof users.$inferInsert)[] = [];
const joinTimes = Array.from(
  { length: USERS },
  () => now - faker.number.int({ min: 40, max: 90 }) * DAY_MS,
).sort((a, b) => a - b);

for (let i = 0; i < USERS; i++) {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  let username =
    i === 0
      ? 'demo'
      : faker.internet
          .username({ firstName: first, lastName: last })
          .replace(/[^A-Za-z0-9_]/g, '_')
          .slice(0, 15);
  while (taken.has(username.toLowerCase()))
    username = `${username.slice(0, 12)}${faker.number.int(99)}`;
  taken.add(username.toLowerCase());

  const id = idAt(joinTimes[i]);
  people.push({ id, username, celebrity: i >= 1 && i <= CELEBRITIES });
  userRows.push({
    id,
    username,
    displayName: i === 0 ? 'Demo User' : `${first} ${last}`,
    bio:
      i === 0
        ? 'Playing around with TwitterMF.'
        : faker.person.bio().slice(0, 160),
    passwordHash,
    createdAt: new Date(joinTimes[i]),
  });
}
await db.insert(users).values(userRows);
const demo = people[0];
const celebrities = people.filter((p) => p.celebrity);

// ---- Follows ---------------------------------------------------------------
const followRows: (typeof follows.$inferInsert)[] = [];
const followed = new Set<string>();
const follow = (a: SeedUser, b: SeedUser) => {
  const key = `${a.id}:${b.id}`;
  if (a.id === b.id || followed.has(key)) return;
  followed.add(key);
  followRows.push({ followerId: a.id, followeeId: b.id });
};
for (const person of people) {
  for (const celeb of celebrities)
    if (person === demo || faker.datatype.boolean(0.8)) follow(person, celeb);
  const n = person === demo ? 25 : faker.number.int({ min: 5, max: 30 });
  for (const other of faker.helpers.arrayElements(people, n))
    follow(person, other);
}
// Your own accounts: follow the celebrities and some others, and get a few
// followers back.
for (const you of yours) {
  for (const celeb of celebrities) follow(you, celeb);
  for (const other of faker.helpers.arrayElements(people, 15))
    follow(you, other);
  for (const fan of faker.helpers.arrayElements(people, 8)) follow(fan, you);
}
console.log(`Creating ${followRows.length} follows…`);
await insertInBatches(followRows, (rows) => db.insert(follows).values(rows));

// ---- Tweets, replies, retweets ----------------------------------------------
// Popularity is lopsided, as on the real thing: celebrities post more and
// get most of the likes and retweets.
const pickAuthor = () =>
  faker.helpers.weightedArrayElement(
    people.map((p) => ({
      value: p,
      weight: p.celebrity ? 12 : p === demo ? 2 : 1,
    })),
  );
const topics = [
  '#buildinpublic',
  '#100DaysOfCode',
  '#systemdesign',
  '#postgres',
  '#redis',
  '#typescript',
  '#coffee',
  '#weekend',
  '',
];
const writeTweet = () =>
  faker.helpers
    .arrayElement([
      () => faker.hacker.phrase(),
      () =>
        `${faker.company.catchPhrase()}. ${faker.helpers.arrayElement(topics)}`,
      () =>
        `Hot take: ${faker.hacker.noun()} is just ${faker.hacker.adjective()} ${faker.hacker.noun()} with extra steps.`,
      () =>
        `Day ${faker.number.int({ min: 1, max: 100 })} of learning ${faker.helpers.arrayElement(['Rust', 'Go', 'Kubernetes', 'SQL', 'system design', 'Redis'])} ${faker.helpers.arrayElement(topics)}`,
      () =>
        `${faker.word.interjection()}! ${faker.lorem.sentence({ min: 4, max: 12 })}`,
      () =>
        `Shipped ${faker.hacker.ingverb()} ${faker.hacker.noun()} today ${faker.helpers.arrayElement(['🚀', '🎉', '😅', '🔥', ''])}`,
    ])()
    .trim()
    .slice(0, 280);
const writeReply = () =>
  faker.helpers.arrayElement([
    'This is so true',
    'Strong disagree, but I see your point',
    'Wait, how did you do that?',
    '😂',
    'Saving this for later',
    'Could you share the code?',
    `Have you tried ${faker.hacker.ingverb()} the ${faker.hacker.noun()}?`,
    `+1, we hit the same ${faker.hacker.noun()} issue last week`,
    'Underrated take',
  ]);

const times = Array.from(
  { length: TWEETS },
  () => now - faker.number.float({ min: 0, max: DAYS }) * DAY_MS,
).sort((a, b) => a - b);
const posted: SeedTweet[] = [];
for (const at of times) {
  const author = pickAuthor();
  const recent = posted.slice(-80);
  const replyTo =
    recent.length > 0 && faker.datatype.boolean(REPLY_SHARE)
      ? faker.helpers.arrayElement(recent)
      : undefined;
  posted.push({
    authorId: author.id,
    at,
    text: replyTo ? writeReply() : writeTweet(),
    replyTo,
    popularity: author.celebrity ? 20 : replyTo ? 0.5 : 1,
  });
}

const pickPopular = () =>
  faker.helpers.weightedArrayElement(
    posted.map((t) => ({ value: t, weight: t.popularity })),
  );
const retweets: SeedTweet[] = [];
const retweetedBy = new Map<SeedUser, Set<SeedTweet>>();
for (let i = 0; i < RETWEETS; i++) {
  const original = pickPopular();
  const by = faker.helpers.arrayElement(people);
  const done = retweetedBy.get(by) ?? new Set();
  if (by.id === original.authorId || done.has(original)) continue;
  done.add(original);
  retweetedBy.set(by, done);
  retweets.push({
    authorId: by.id,
    at: faker.number.float({ min: original.at, max: now }),
    text: '',
    retweetOf: original,
    popularity: 0,
  });
}

// IDs are assigned only now, across tweets and retweets in time order, so a
// Snowflake's timestamp always matches its row's created_at, and a retweet
// sorts by when it was retweeted.
const allTweets = [...posted, ...retweets].sort((a, b) => a.at - b.at);
for (const t of allTweets) t.id = idAt(t.at);
console.log(
  `Creating ${posted.length} tweets (incl. replies) and ${retweets.length} retweets…`,
);
await insertInBatches(
  allTweets.map((t) => ({
    id: t.id!,
    authorId: t.authorId,
    text: t.text,
    replyToId: t.replyTo?.id ?? null,
    retweetOfId: t.retweetOf?.id ?? null,
    createdAt: new Date(t.at),
  })),
  (rows) => db.insert(tweets).values(rows),
);

// ---- Likes -------------------------------------------------------------------
const liked = new Set<string>();
const likeRows: (typeof likes.$inferInsert)[] = [];
for (let i = 0; i < LIKES; i++) {
  const t = pickPopular();
  const by = faker.helpers.arrayElement([...people, ...yours]);
  const key = `${by.id}:${t.id}`;
  if (liked.has(key)) continue;
  liked.add(key);
  likeRows.push({
    userId: by.id,
    tweetId: t.id!,
    createdAt: new Date(faker.number.float({ min: t.at, max: now })),
  });
}
console.log(`Creating ${likeRows.length} likes…`);
await insertInBatches(likeRows, (rows) => db.insert(likes).values(rows));

// ---- Derived data --------------------------------------------------------------
console.log('Computing counts and rebuilding the username bloom filter…');
await app.get(CountersService).reconcile();
await app.get(UsernamesService).rebuild();

console.log(`
Done. Log in at http://localhost:3001/login
  username: demo    password: ${PASSWORD}
Every seeded account uses the same password.
Celebrities: ${celebrities.map((c) => `@${c.username}`).join(', ')}`);
if (yours.length)
  console.log(
    `Your accounts (${yours.map((y) => `@${y.username}`).join(', ')}) now follow some of them.`,
  );
await app.close();

async function insertInBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += 500)
    await insert(rows.slice(i, i + 500));
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}
