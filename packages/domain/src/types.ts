import { z } from "zod";

/** HackerOne platform marker. Only "hackerone" in MVP. */
export const PLATFORM_HACKERONE = "hackerone" as const;

export const assetTypeSchema = z.enum([
  "DOMAIN",
  "WILDCARD",
  "IP",
  "CIDR",
  "URL",
  "ANDROID",
  "IOS",
  "API",
  "OTHER",
]);

export type AssetType = z.infer<typeof assetTypeSchema>;

export const scopeSchema = z.enum(["IN", "OUT"]);
export type Scope = z.infer<typeof scopeSchema>;

export const collectedProgramSchema = z.object({
  /** HackerOne handle, e.g. "acme". */
  externalId: z.string().min(1),
  name: z.string().min(1),
  platform: z.literal(PLATFORM_HACKERONE),
  url: z.string().url().optional(),
  externalNumericId: z.string().optional(),
});

export type CollectedProgram = z.infer<typeof collectedProgramSchema>;

export const collectedAssetSchema = z.object({
  /** HackerOne structured-scope id. */
  externalId: z.string().optional(),
  /** Canonicalized identifier (see canonicalize()). */
  identifier: z.string().min(1).max(1024),
  type: assetTypeSchema,
  /** IN = eligible_for_bounty == true. */
  scope: scopeSchema,
});

export type CollectedAsset = z.infer<typeof collectedAssetSchema>;

export const changeTypeSchema = z.enum(["PROGRAM_ADDED", "ASSET_ADDED", "ASSET_REMOVED"]);
export type ChangeType = z.infer<typeof changeTypeSchema>;

export interface ProgramDiffInput {
  program: CollectedProgram;
  assets: CollectedAsset[];
}

/** Previous live state for one program, loaded before any upsert. */
export interface PreviousProgramState {
  programId: string;
  /** Canonical IN-scope assets: key (`type|normalized_identifier`) → display identifier. */
  inAssets: Map<string, string>;
}

export interface DetectedChange {
  type: ChangeType;
  /** HackerOne handle (lowercased). */
  programKey: string;
  /** Canonical asset key; null for PROGRAM_ADDED. */
  assetKey: string | null;
  /** Display identifier; null for PROGRAM_ADDED. */
  assetIdentifier: string | null;
}

export interface DiffResult {
  programAdded: boolean;
  added: { assetKey: string; assetIdentifier: string }[];
  removed: { assetKey: string; assetIdentifier: string }[];
}

/** Program lookup key: platform + lowercased handle. */
export function programKey(platform: string, externalId: string): string {
  return `${platform}|${externalId.toLowerCase()}`;
}

/** Canonical diff key (per program): `type|normalized_identifier`. */
export function assetKey(type: AssetType, normalizedIdentifier: string): string {
  return `${type}|${normalizedIdentifier}`;
}
