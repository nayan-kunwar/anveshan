CREATE TABLE IF NOT EXISTS "asset_snapshots" (
	"collection_run_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_key" text NOT NULL,
	CONSTRAINT "asset_snapshots_collection_run_id_program_id_asset_id_pk" PRIMARY KEY("collection_run_id","program_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"external_id" text,
	"identifier" text NOT NULL,
	"normalized_identifier" text NOT NULL,
	"type" text NOT NULL,
	"scope" text NOT NULL,
	"asset_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_scope_check" CHECK ("assets"."scope" IN ('IN','OUT')),
	CONSTRAINT "assets_identifier_length_check" CHECK (char_length("assets"."normalized_identifier") BETWEEN 1 AND 1024)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"program_id" uuid NOT NULL,
	"asset_id" uuid,
	"asset_key" text,
	"asset_identifier" text,
	"collection_run_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changes_type_check" CHECK ("changes"."type" IN ('PROGRAM_ADDED','ASSET_ADDED','ASSET_REMOVED'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text NOT NULL,
	"programs_seen" integer DEFAULT 0 NOT NULL,
	"assets_seen" integer DEFAULT 0 NOT NULL,
	"programs_added" integer DEFAULT 0 NOT NULL,
	"assets_added" integer DEFAULT 0 NOT NULL,
	"assets_removed" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "program_snapshots" (
	"collection_run_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	CONSTRAINT "program_snapshots_collection_run_id_program_id_pk" PRIMARY KEY("collection_run_id","program_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'hackerone' NOT NULL,
	"external_id" text NOT NULL,
	"external_id_lower" text NOT NULL,
	"external_numeric_id" text,
	"name" text NOT NULL,
	"url" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_platform_check" CHECK ("programs"."platform" = 'hackerone')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "changes" ADD CONSTRAINT "changes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "changes" ADD CONSTRAINT "changes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "changes" ADD CONSTRAINT "changes_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "program_snapshots" ADD CONSTRAINT "program_snapshots_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "program_snapshots" ADD CONSTRAINT "program_snapshots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_run_idx" ON "asset_snapshots" USING btree ("collection_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_program_key_uq" ON "assets" USING btree ("program_id","asset_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_program_scope_idx" ON "assets" USING btree ("program_id","scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changes_program_detected_idx" ON "changes" USING btree ("program_id","detected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changes_run_idx" ON "changes" USING btree ("collection_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "changes_program_added_uq" ON "changes" USING btree ("collection_run_id","program_id") WHERE "changes"."type" = 'PROGRAM_ADDED';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "changes_asset_event_uq" ON "changes" USING btree ("collection_run_id","type","program_id","asset_key") WHERE "changes"."type" IN ('ASSET_ADDED','ASSET_REMOVED');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "programs_platform_handle_uq" ON "programs" USING btree ("platform","external_id_lower");