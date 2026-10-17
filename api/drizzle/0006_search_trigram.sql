-- Trigrams: every 3-letter slice of a string ("alice" -> "ali", "lic", "ice"
-- ...), indexed so substring and fuzzy matches can use an index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "tweets_text_trgm_idx" ON "tweets" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_username_trgm_idx" ON "users" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_display_name_trgm_idx" ON "users" USING gin ("display_name" gin_trgm_ops);