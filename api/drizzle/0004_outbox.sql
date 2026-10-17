CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Wake the relay the moment outbox rows are committed (LISTEN/NOTIFY), so
-- jobs start within milliseconds instead of waiting for the next poll.
-- NOTIFY is delivered only on COMMIT: a rolled-back insert wakes nobody.
CREATE FUNCTION "outbox_notify"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "outbox_notify" AFTER INSERT ON "outbox"
  FOR EACH STATEMENT EXECUTE FUNCTION "outbox_notify"();
