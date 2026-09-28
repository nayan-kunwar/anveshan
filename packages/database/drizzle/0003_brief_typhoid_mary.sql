CREATE TABLE IF NOT EXISTS "scheduler_settings" (
	"job_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
