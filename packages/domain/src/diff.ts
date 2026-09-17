import { assetKey } from "./types.js";
import type {
  CollectedAsset,
  CollectedProgram,
  DiffResult,
  PreviousProgramState,
} from "./types.js";

/**
 * Pure domain diff for one program.
 *
 * - Compares the incoming IN-scope set against previous live IN-scope rows.
 * - `prev === null` means the program is new: emits PROGRAM_ADDED only
 *   (initial scope is visible via the assets endpoint; no per-asset events).
 * - Missing from payload and IN→OUT flips both surface as REMOVED,
 *   because both leave the IN set. The caller reconciles live rows to OUT.
 * - `isFirst` (baseline run) suppresses everything.
 *
 * No Express, no Drizzle, no HTTP — pure sets in, changes out.
 */
export function diffProgram(
  prev: PreviousProgramState | null,
  _program: CollectedProgram,
  incoming: CollectedAsset[],
  isFirst: boolean,
): DiffResult {
  if (isFirst) {
    return { programAdded: false, added: [], removed: [] };
  }
  if (prev === null) {
    return { programAdded: true, added: [], removed: [] };
  }

  const currIn = new Map<string, string>();
  for (const asset of incoming) {
    if (asset.scope !== "IN") continue;
    const key = assetKey(asset.type, asset.identifier);
    if (!currIn.has(key)) currIn.set(key, asset.identifier);
  }

  const added: DiffResult["added"] = [];
  for (const [key, identifier] of currIn) {
    if (!prev.inAssets.has(key))
      added.push({ assetKey: key, assetIdentifier: identifier });
  }

  const removed: DiffResult["removed"] = [];
  for (const [key, identifier] of prev.inAssets) {
    if (!currIn.has(key)) removed.push({ assetKey: key, assetIdentifier: identifier });
  }

  return { programAdded: false, added, removed };
}
