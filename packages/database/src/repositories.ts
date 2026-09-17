import { and, count, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import type { AssetRow, NewChangeRow, ProgramRow } from "./schema.js";
import {
  assetSnapshots,
  assets,
  changes,
  collectionRuns,
  programSnapshots,
  programs,
} from "./schema.js";
import type { Db } from "./db.js";

// --- programs ---

export interface UpsertProgramInput {
  platform: string;
  externalId: string;
  name: string;
  url?: string | undefined;
  externalNumericId?: string | undefined;
}

export async function upsertProgram(
  db: Db,
  input: UpsertProgramInput,
): Promise<ProgramRow> {
  const externalIdLower = input.externalId.toLowerCase();
  const rows = await db
    .insert(programs)
    .values({
      platform: input.platform,
      externalId: input.externalId,
      externalIdLower,
      externalNumericId: input.externalNumericId ?? null,
      name: input.name,
      url: input.url ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [programs.platform, programs.externalIdLower],
      set: {
        name: input.name,
        url: input.url ?? null,
        externalNumericId: input.externalNumericId ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertProgram returned no row");
  return row;
}

export async function findAllPrograms(
  db: Db,
): Promise<Pick<ProgramRow, "id" | "platform" | "externalIdLower">[]> {
  return db
    .select({
      id: programs.id,
      platform: programs.platform,
      externalIdLower: programs.externalIdLower,
    })
    .from(programs);
}

export async function findProgramById(
  db: Db,
  id: string,
): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(eq(programs.id, id)).limit(1);
  return rows[0];
}

export async function countPrograms(db: Db): Promise<number> {
  const rows = await db.select({ value: count() }).from(programs);
  return rows[0]?.value ?? 0;
}

export async function listPrograms(
  db: Db,
  page: number,
  pageSize: number,
): Promise<{ items: ProgramRow[]; total: number }> {
  const totalRows = await db.select({ value: count() }).from(programs);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(programs)
    .orderBy(programs.name)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

// --- assets ---

export interface UpsertAssetInput {
  programId: string;
  externalId?: string | undefined;
  identifier: string;
  normalizedIdentifier: string;
  type: string;
  scope: "IN" | "OUT";
}

export async function upsertAsset(db: Db, input: UpsertAssetInput): Promise<AssetRow> {
  const assetKey = `${input.type}|${input.normalizedIdentifier}`;
  const rows = await db
    .insert(assets)
    .values({
      programId: input.programId,
      externalId: input.externalId ?? null,
      identifier: input.identifier,
      normalizedIdentifier: input.normalizedIdentifier,
      type: input.type,
      scope: input.scope,
      assetKey,
    })
    .onConflictDoUpdate({
      target: [assets.programId, assets.assetKey],
      set: {
        externalId: input.externalId ?? null,
        identifier: input.identifier,
        normalizedIdentifier: input.normalizedIdentifier,
        type: input.type,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertAsset returned no row");
  return row;
}

export type LiveAsset = Pick<AssetRow, "id" | "assetKey" | "scope" | "identifier">;

export async function findAssetsByProgram(
  db: Db,
  programId: string,
): Promise<LiveAsset[]> {
  return db
    .select({
      id: assets.id,
      assetKey: assets.assetKey,
      scope: assets.scope,
      identifier: assets.identifier,
    })
    .from(assets)
    .where(eq(assets.programId, programId));
}

/**
 * Reconcile missing scopes: every live row for this program whose key was
 * NOT in the latest fetch is flipped to OUT (never deleted).
 */
export async function markMissingAssetsOut(
  db: Db,
  programId: string,
  seenKeys: string[],
): Promise<void> {
  if (seenKeys.length === 0) {
    await db
      .update(assets)
      .set({ scope: "OUT", updatedAt: new Date() })
      .where(eq(assets.programId, programId));
    return;
  }
  await db
    .update(assets)
    .set({ scope: "OUT", updatedAt: new Date() })
    .where(and(eq(assets.programId, programId), notInArray(assets.assetKey, seenKeys)));
}

export async function listAssets(
  db: Db,
  programId: string,
  scope: "ALL" | "IN" | "OUT",
  page: number,
  pageSize: number,
): Promise<{ items: AssetRow[]; total: number }> {
  const where =
    scope === "ALL"
      ? eq(assets.programId, programId)
      : and(eq(assets.programId, programId), eq(assets.scope, scope));
  const totalRows = await db.select({ value: count() }).from(assets).where(where);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(assets)
    .where(where)
    .orderBy(assets.identifier)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

// --- collection runs ---

export async function createRun(db: Db): Promise<{ id: string }> {
  const rows = await db
    .insert(collectionRuns)
    .values({ status: "running" })
    .returning({ id: collectionRuns.id });
  const row = rows[0];
  if (!row) throw new Error("createRun returned no row");
  return row;
}

export interface RunStats {
  programsSeen: number;
  assetsSeen: number;
  programsAdded: number;
  assetsAdded: number;
  assetsRemoved: number;
}

export async function completeRun(db: Db, id: string, stats: RunStats): Promise<void> {
  await db
    .update(collectionRuns)
    .set({ status: "completed", completedAt: new Date(), ...stats })
    .where(eq(collectionRuns.id, id));
}

export async function failRun(
  db: Db,
  id: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(collectionRuns)
    .set({ status: "failed", completedAt: new Date(), errorCode, errorMessage })
    .where(eq(collectionRuns.id, id));
}

export async function countCompletedRuns(db: Db): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(collectionRuns)
    .where(eq(collectionRuns.status, "completed"));
  return rows[0]?.value ?? 0;
}

export async function failStaleRunningRuns(db: Db, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(collectionRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorCode: "COLLECTION_FAILED",
      errorMessage: "stale running row",
    })
    .where(
      and(eq(collectionRuns.status, "running"), lt(collectionRuns.startedAt, cutoff)),
    )
    .returning({ id: collectionRuns.id });
  return rows.length;
}

// --- snapshots (pointers) ---

export async function insertProgramSnapshot(
  db: Db,
  runId: string,
  programId: string,
): Promise<void> {
  await db
    .insert(programSnapshots)
    .values({ collectionRunId: runId, programId })
    .onConflictDoNothing();
}

export async function insertAssetSnapshot(
  db: Db,
  runId: string,
  programId: string,
  assetId: string,
  assetKey: string,
): Promise<void> {
  await db
    .insert(assetSnapshots)
    .values({ collectionRunId: runId, programId, assetId, assetKey })
    .onConflictDoNothing();
}

// --- changes ---

export type NewChangeInput = Omit<NewChangeRow, "id" | "detectedAt">;

export async function insertChange(db: Db, input: NewChangeInput): Promise<void> {
  // Bare ON CONFLICT DO NOTHING: set-diff guarantees no duplicates;
  // the partial unique indexes are the backstop.
  await db.insert(changes).values(input).onConflictDoNothing();
}

export async function listChanges(
  db: Db,
  programId: string,
  since: Date | undefined,
  page: number,
  pageSize: number,
): Promise<{ items: (typeof changes.$inferSelect)[]; total: number }> {
  const where =
    since === undefined
      ? eq(changes.programId, programId)
      : and(eq(changes.programId, programId), gte(changes.detectedAt, since));
  const totalRows = await db.select({ value: count() }).from(changes).where(where);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(changes)
    .where(where)
    .orderBy(desc(changes.detectedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

/** Test helper: wipe all rows (never used in production code paths). */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE changes, asset_snapshots, program_snapshots, assets, programs, collection_runs`,
  );
}
