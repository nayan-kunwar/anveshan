import { sql } from "drizzle-orm";
import {
  check,
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

export const schema = {
  programs,
  assets,
  collectionRuns,
  programSnapshots,
  assetSnapshots,
  changes,
};
