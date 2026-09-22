import type { AssetRow, ChangeRow, ProgramRow } from "@anveshan/database";
import { AppError } from "../errors.js";

// API shapes (must match docs/openapi.yaml).

export interface ProgramDto {
  id: string;
  platform: string;
  externalId: string;
  name: string;
  url?: string;
  updatedAt: string;
}

export interface AssetDto {
  id: string;
  identifier: string;
  type: string;
  scope: string;
}

export interface ChangeDto {
  id: string;
  type: string;
  programId: string;
  assetId: string | null;
  assetIdentifier: string | null;
  collectionRunId: string;
  detectedAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Read-model boundary. Controllers depend on this interface, not Drizzle —
 * tests inject an in-memory fake, production injects the Drizzle adapter.
 */
export interface ProgramStore {
  listPrograms(
    page: number,
    pageSize: number,
    q?: string,
  ): Promise<{ items: ProgramRow[]; total: number }>;
  findProgramById(id: string): Promise<ProgramRow | undefined>;
  listAssets(
    programId: string,
    scope: "ALL" | "IN" | "OUT",
    page: number,
    pageSize: number,
  ): Promise<{ items: AssetRow[]; total: number }>;
  listChanges(
    programId: string,
    since: Date | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: ChangeRow[]; total: number }>;
}

export function toProgramDto(row: ProgramRow): ProgramDto {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    name: row.name,
    ...(row.url ? { url: row.url } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAssetDto(row: AssetRow): AssetDto {
  return { id: row.id, identifier: row.identifier, type: row.type, scope: row.scope };
}

export function toChangeDto(row: ChangeRow): ChangeDto {
  return {
    id: row.id,
    type: row.type,
    programId: row.programId,
    assetId: row.assetId,
    assetIdentifier: row.assetIdentifier,
    collectionRunId: row.collectionRunId,
    detectedAt: row.detectedAt.toISOString(),
  };
}

export async function getProgramOrThrow(
  store: ProgramStore,
  id: string,
): Promise<ProgramRow> {
  const program = await store.findProgramById(id);
  if (!program) throw AppError.programNotFound();
  return program;
}
