DROP INDEX IF EXISTS "deliveries_daily_uq";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "digest_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "digest_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "digest_time_local" time DEFAULT '08:00' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_daily_uq" ON "notification_deliveries" USING btree ("user_id","digest_close_at","channel") WHERE "notification_deliveries"."kind" = 'daily';