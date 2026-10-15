ALTER TABLE "tweets" DROP CONSTRAINT "tweets_text_length";--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "retweet_of_id" bigint;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "retweet_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "follower_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "following_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tweet_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_reply_to_id_tweets_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."tweets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_retweet_of_id_tweets_id_fk" FOREIGN KEY ("retweet_of_id") REFERENCES "public"."tweets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tweets_reply_to_id_id_idx" ON "tweets" USING btree ("reply_to_id","id" DESC NULLS LAST) WHERE "tweets"."reply_to_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tweets_one_retweet_per_user_idx" ON "tweets" USING btree ("author_id","retweet_of_id") WHERE "tweets"."retweet_of_id" is not null;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_text_or_retweet" CHECK (("tweets"."retweet_of_id" is null and char_length("tweets"."text") between 1 and 280)
          or ("tweets"."retweet_of_id" is not null and "tweets"."text" = ''));--> statement-breakpoint
-- Backfill the new counters from the rows that already exist.
UPDATE "users" u SET
  "follower_count"  = (SELECT count(*) FROM "follows" f WHERE f."followee_id" = u."id"),
  "following_count" = (SELECT count(*) FROM "follows" f WHERE f."follower_id" = u."id"),
  "tweet_count"     = (SELECT count(*) FROM "tweets" t WHERE t."author_id" = u."id");--> statement-breakpoint
UPDATE "tweets" t SET
  "like_count" = (SELECT count(*) FROM "likes" l WHERE l."tweet_id" = t."id");
