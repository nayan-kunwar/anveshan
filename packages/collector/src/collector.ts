import type { CollectedAsset, CollectedProgram } from "@anveshan/domain";
import {
  PLATFORM_HACKERONE,
  canonicalize,
  collectedAssetSchema,
  collectedProgramSchema,
  isKnownHackerOneAssetType,
  mapHackerOneAssetType,
} from "@anveshan/domain";
import type { HackerOneClient, ScopeItem } from "./client.js";
import type { HackerOneLogger } from "./client.js";

export interface ProgramCollector {
  /** Programs WITHOUT nested assets — scopes come from getProgramAssets. */
  getPrograms(): Promise<CollectedProgram[]>;
  getProgramAssets(programHandle: string): Promise<CollectedAsset[]>;
}

interface CollectorLogger {
  warn(message: string, details?: Record<string, unknown>): void;
}

const noopLogger: CollectorLogger = { warn: () => undefined };

export class HackerOneCollector implements ProgramCollector {
  private readonly client: HackerOneClient;
  private readonly logger: CollectorLogger;

  constructor(client: HackerOneClient, logger?: HackerOneLogger) {
    this.client = client;
    this.logger = logger ?? noopLogger;
  }

  async getPrograms(): Promise<CollectedProgram[]> {
    const items = await this.client.listPrograms();
    const programs: CollectedProgram[] = [];
    for (const item of items) {
      const candidate = {
        externalId: item.handle,
        name: item.name,
        platform: PLATFORM_HACKERONE,
        url: `https://hackerone.com/${item.handle}`,
        externalNumericId: item.id,
      };
      const parsed = collectedProgramSchema.safeParse(candidate);
      if (!parsed.success) {
        this.logger.warn("Skipping program with invalid shape", { handle: item.handle });
        continue;
      }
      programs.push(parsed.data);
    }
    return programs;
  }

  async getProgramAssets(programHandle: string): Promise<CollectedAsset[]> {
    const items = await this.client.listScopes(programHandle);
    const assets: CollectedAsset[] = [];
    for (const item of items) {
      const normalized = normalizeScope(item, programHandle, this.logger);
      if (normalized) assets.push(normalized);
    }
    return assets;
  }
}

function normalizeScope(
  item: ScopeItem,
  programHandle: string,
  logger: CollectorLogger,
): CollectedAsset | null {
  if (typeof item.assetIdentifier !== "string") {
    logger.warn("Dropping scope with missing identifier", {
      programHandle,
      scopeId: item.id,
    });
    return null;
  }
  const type = mapHackerOneAssetType(item.assetType);
  if (typeof item.assetType === "string" && !isKnownHackerOneAssetType(item.assetType)) {
    logger.warn("Unmapped HackerOne asset_type, kept as OTHER", {
      programHandle,
      scopeId: item.id,
      assetType: item.assetType,
    });
  }
  const identifier = canonicalize(item.assetIdentifier, type);
  if (identifier === null) {
    logger.warn("Dropping scope with unusable identifier", {
      programHandle,
      scopeId: item.id,
      // Truncated raw text so drops are auditable (which program lists
      // what) without flooding logs. Scope data is public by design.
      identifier: item.assetIdentifier.slice(0, 200),
    });
    return null;
  }
  const candidate = {
    externalId: item.id,
    identifier,
    type,
    scope: item.eligibleForBounty ? ("IN" as const) : ("OUT" as const),
  };
  const parsed = collectedAssetSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.warn("Dropping scope that failed validation", {
      programHandle,
      scopeId: item.id,
    });
    return null;
  }
  return parsed.data;
}
