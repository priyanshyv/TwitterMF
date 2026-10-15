-- EXPLAIN lab: what do indexes change for our two hottest queries?
-- Run from the repo root:  npm run lab:explain
-- Builds a throwaway schema (explain_lab) with 10k users, 1M tweets and 200k
-- follows, runs each query without and then with indexes, and drops it all.

\set QUIET on
\pset pager off
set client_min_messages = warning;
drop schema if exists explain_lab cascade;
create schema explain_lab;
set search_path = explain_lab;

-- Same shape as the real tables, but deliberately WITHOUT secondary indexes.
create table tweets (id bigint primary key, author_id bigint not null, text text not null);
create table follows (follower_id bigint not null, followee_id bigint not null);

\echo 'Seeding 1,000,000 tweets and 200,000 follows (a few seconds)...'
insert into tweets
  select g, (random() * 9999)::int + 1, 'tweet ' || g
  from generate_series(1, 1000000) g;
insert into follows
  select u, (random() * 9999)::int + 1
  from generate_series(1, 10000) u, generate_series(1, 20);
analyze tweets;
analyze follows;
\set QUIET off

\echo ''
\echo '================ 1. Profile: user 42''s latest 20 tweets ================'
\echo '---- WITHOUT an index on tweets(author_id, id desc) ----'
explain (analyze, buffers, costs off, summary on)
  select id from tweets where author_id = 42 order by id desc limit 20;

\echo ''
\echo '================ 2. Home timeline: latest 20 tweets from people user 7 follows ================'
\echo '---- WITHOUT indexes ----'
explain (analyze, buffers, costs off, summary on)
  select t.id from tweets t
  where t.author_id in (select followee_id from follows where follower_id = 7)
  order by t.id desc limit 20;

\set QUIET on
create index on tweets (author_id, id desc);
create index on follows (follower_id);
analyze tweets;
analyze follows;
\set QUIET off

\echo ''
\echo '================ 1. Profile, again ================'
\echo '---- WITH the index ----'
explain (analyze, buffers, costs off, summary on)
  select id from tweets where author_id = 42 order by id desc limit 20;

\echo ''
\echo '================ 2. Home timeline, again ================'
\echo '---- WITH indexes ----'
explain (analyze, buffers, costs off, summary on)
  select t.id from tweets t
  where t.author_id in (select followee_id from follows where follower_id = 7)
  order by t.id desc limit 20;

\echo ''
\echo '================ 3. Home timeline, rewritten with LATERAL ================'
\echo '---- WITH indexes: for each followee, take their newest 20 from the index, then merge ----'
explain (analyze, buffers, costs off, summary on)
  select t.id from follows f
  cross join lateral (
    select id from tweets where author_id = f.followee_id order by id desc limit 20
  ) t
  where f.follower_id = 7
  order by t.id desc limit 20;

\set QUIET on
drop schema explain_lab cascade;
