CREATE TYPE "public"."media_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "media" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"tweet_id" bigint,
	"position" smallint DEFAULT 0 NOT NULL,
	"status" "media_status" DEFAULT 'uploading' NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tweets" DROP CONSTRAINT "tweets_text_or_retweet";--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_tweet_id_tweets_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."tweets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_tweet_id_idx" ON "media" USING btree ("tweet_id","position") WHERE "media"."tweet_id" is not null;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_text_or_retweet" CHECK (("tweets"."retweet_of_id" is null and char_length("tweets"."text") <= 280)
          or ("tweets"."retweet_of_id" is not null and "tweets"."text" = ''));