import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema implements docs/database.md migration 001.
 *
 * Conventions:
 * - `externalIdLower` / `assetKey` are computed by the application
 *   (lowercased handle / `type|normalized_identifier`) — Postgres
 *   generated columns are avoided for Drizzle portability.
 * - No `program_assets` join table: `assets.program_id` owns the
 *   relationship (HackerOne scopes are per-program).
 */
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull().default("hackerone"),
    externalId: text("external_id").notNull(),
    externalIdLower: text("external_id_lower").notNull(),
    externalNumericId: text("external_numeric_id"),
    name: text("name").notNull(),
    url: text("url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("programs_platform_handle_uq").on(t.platform, t.externalIdLower),
    check("programs_platform_check", sql`${t.platform} = 'hackerone'`),
  ],
);

export type ProgramRow = typeof programs.$inferSelect;
export type NewProgramRow = typeof programs.$inferInsert;

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    identifier: text("identifier").notNull(),
    normalizedIdentifier: text("normalized_identifier").notNull(),
    type: text("type").notNull(),
    scope: text("scope").notNull(),
    assetKey: text("asset_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_program_key_uq").on(t.programId, t.assetKey),
    index("assets_program_scope_idx").on(t.programId, t.scope),
    check("assets_scope_check", sql`${t.scope} IN ('IN','OUT')`),
    check(
      "assets_identifier_length_check",
      sql`char_length(${t.normalizedIdentifier}) BETWEEN 1 AND 1024`,
    ),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

export const collectionRuns = pgTable("collection_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull(),
  programsSeen: integer("programs_seen").notNull().default(0),
  assetsSeen: integer("assets_seen").notNull().default(0),
  programsAdded: integer("programs_added").notNull().default(0),
  assetsAdded: integer("assets_added").notNull().default(0),
  assetsRemoved: integer("assets_removed").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
});

export type CollectionRunRow = typeof collectionRuns.$inferSelect;

export const programSnapshots = pgTable(
  "program_snapshots",
  {
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.collectionRunId, t.programId] })],
);

export const assetSnapshots = pgTable(
  "asset_snapshots",
  {
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    assetKey: text("asset_key").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionRunId, t.programId, t.assetId] }),
    index("snapshots_run_idx").on(t.collectionRunId),
  ],
);

export const changes = pgTable(
  "changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    assetKey: text("asset_key"),
    assetIdentifier: text("asset_identifier"),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "changes_type_check",
      sql`${t.type} IN ('PROGRAM_ADDED','ASSET_ADDED','ASSET_REMOVED')`,
    ),
    index("changes_program_detected_idx").on(t.programId, t.detectedAt),
    index("changes_run_idx").on(t.collectionRunId),
    // Digest window queries filter on detected_at alone.
    index("changes_detected_at_idx").on(t.detectedAt),
    // Postgres UNIQUE treats NULL as distinct, so plain uniques would not
    // dedupe PROGRAM_ADDED rows (asset columns NULL). Partial indexes are
    // NULL-safe by construction.
    uniqueIndex("changes_program_added_uq")
      .on(t.collectionRunId, t.programId)
      .where(sql`${t.type} = 'PROGRAM_ADDED'`),
    uniqueIndex("changes_asset_event_uq")
      .on(t.collectionRunId, t.type, t.programId, t.assetKey)
      .where(sql`${t.type} IN ('ASSET_ADDED','ASSET_REMOVED')`),
  ],
);

export type ChangeRow = typeof changes.$inferSelect;
export type NewChangeRow = typeof changes.$inferInsert;

/**
 * Milestone 2: email notifications (see docs/notification-design.md).
 *
 * Conventions:
 * - Emails are stored lowercased by the application; UNIQUE(email) is enough.
 * - Token hashes are HMAC-SHA256 (see apps/api/src/auth/tokens.ts).
 *   Raw tokens are never stored.
 * - `subscriptions` has no row until the user saves one in the dashboard.
 *   No row (or unsubscribed_at set) means "send nothing".
 * - Empty `watches` + watch_all_programs=false means "send nothing".
 *   PROGRAM_ADDED needs the separate watch_new_programs flag.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("magic_link_tokens_user_idx").on(t.userId, t.createdAt)],
);

export type MagicLinkTokenRow = typeof magicLinkTokens.$inferSelect;

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type SessionRow = typeof sessions.$inferSelect;

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull(),
    watchNewPrograms: boolean("watch_new_programs").notNull().default(false),
    watchAllPrograms: boolean("watch_all_programs").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("subscriptions_frequency_check", sql`${t.frequency} IN ('immediate','daily')`),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const watches = pgTable(
  "watches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.programId] })],
);

export type WatchRow = typeof watches.$inferSelect;

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    kind: text("kind").notNull(),
    collectionRunId: uuid("collection_run_id").references(() => collectionRuns.id, {
      onDelete: "cascade",
    }),
    digestOn: date("digest_on"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deliveries_channel_check", sql`${t.channel} IN ('email')`),
    check("deliveries_kind_check", sql`${t.kind} IN ('immediate','daily')`),
    check(
      "deliveries_status_check",
      sql`${t.status} IN ('pending','sending','sent','failed','skipped')`,
    ),
    check(
      "deliveries_kind_columns_check",
      sql`(${t.kind} = 'immediate' AND ${t.collectionRunId} IS NOT NULL AND ${t.digestOn} IS NULL) OR (${t.kind} = 'daily' AND ${t.digestOn} IS NOT NULL AND ${t.collectionRunId} IS NULL)`,
    ),
    // Partial uniques (NULL-safe). Enqueue uses index inference
    // (target + where), never ON CONSTRAINT — see docs/notification-design.md.
    uniqueIndex("deliveries_immediate_uq")
      .on(t.userId, t.collectionRunId, t.channel)
      .where(sql`${t.kind} = 'immediate'`),
    uniqueIndex("deliveries_daily_uq")
      .on(t.userId, t.digestOn, t.channel)
      .where(sql`${t.kind} = 'daily'`),
    index("deliveries_worker_idx")
      .on(t.status, t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} IN ('pending','sending')`),
    index("deliveries_user_idx").on(t.userId),
  ],
);

export type DeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewDeliveryRow = typeof notificationDeliveries.$inferInsert;

export const schema = {
  programs,
  assets,
  collectionRuns,
  programSnapshots,
  assetSnapshots,
  changes,
  users,
  magicLinkTokens,
  sessions,
  subscriptions,
  watches,
  notificationDeliveries,
};
