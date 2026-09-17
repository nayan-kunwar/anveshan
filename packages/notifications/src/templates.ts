/**
 * Email rendering. Pure functions: no DB, no SMTP, no crypto.
 * The caller (delivery worker) builds the unsubscribe URL with
 * signUnsubscribe() and passes it in — this package never sees secrets.
 */

export interface TemplateChange {
  type: "PROGRAM_ADDED" | "ASSET_ADDED" | "ASSET_REMOVED";
  programId: string;
  programName: string;
  /** Raw `asset_key` (`TYPE|identifier`); null for PROGRAM_ADDED. */
  assetKey: string | null;
  assetIdentifier: string | null;
}

export interface RenderedMail {
  subject: string;
  text: string;
}

export interface RenderOptions {
  frontendUrl: string;
  unsubscribeUrl: string;
  programCap?: number | undefined;
  assetCap?: number | undefined;
}

const DEFAULT_PROGRAM_CAP = 20;
const DEFAULT_ASSET_CAP = 10;

interface ProgramGroup {
  programId: string;
  programName: string;
  changes: TemplateChange[];
}

function groupByProgram(changes: TemplateChange[]): ProgramGroup[] {
  const groups: ProgramGroup[] = [];
  const byId = new Map<string, ProgramGroup>();
  for (const change of changes) {
    let group = byId.get(change.programId);
    if (!group) {
      group = {
        programId: change.programId,
        programName: change.programName,
        changes: [],
      };
      byId.set(change.programId, group);
      groups.push(group);
    }
    group.changes.push(change);
  }
  return groups;
}

/** Split `TYPE|identifier` on the first pipe. */
function splitAssetKey(assetKey: string): { type: string; identifier: string } {
  const idx = assetKey.indexOf("|");
  if (idx < 0) return { type: "OTHER", identifier: assetKey };
  return { type: assetKey.slice(0, idx), identifier: assetKey.slice(idx + 1) };
}

function changeLine(change: TemplateChange): string {
  if (change.type === "PROGRAM_ADDED") {
    return `  + PROGRAM_ADDED  ${change.programName}`;
  }
  const key = change.assetKey ?? `OTHER|${change.assetIdentifier ?? "unknown"}`;
  const { type, identifier } = splitAssetKey(key);
  const sign = change.type === "ASSET_ADDED" ? "+" : "-";
  return `  ${sign} ${change.type}  ${identifier} (${type})`;
}

function footer(frontendUrl: string, unsubscribeUrl: string): string {
  return [
    "---",
    `Manage subscriptions: ${frontendUrl}/dashboard`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

export function renderImmediate(
  changes: TemplateChange[],
  options: RenderOptions,
): RenderedMail {
  const programCap = options.programCap ?? DEFAULT_PROGRAM_CAP;
  const assetCap = options.assetCap ?? DEFAULT_ASSET_CAP;
  if (changes.length === 0) {
    return {
      subject: "[Anveshan] No new changes",
      text: [
        "Hi,",
        "",
        "No changes in your watched programs.",
        "",
        footer(options.frontendUrl, options.unsubscribeUrl),
      ].join("\n"),
    };
  }
  const groups = groupByProgram(changes);
  const shownGroups = groups.slice(0, programCap);
  const hiddenPrograms = groups.length - shownGroups.length;
  const totalChanges = changes.length;
  const shownChanges = shownGroups.reduce(
    (n, g) => n + Math.min(g.changes.length, assetCap),
    0,
  );

  const singleName = groups.length === 1 ? (groups[0]?.programName ?? "unknown") : null;
  const subject =
    singleName !== null
      ? `[Anveshan] ${totalChanges} change${totalChanges === 1 ? "" : "s"} in ${singleName}`
      : `[Anveshan] ${totalChanges} changes in ${groups.length} programs`;

  const lines = [
    "Hi,",
    "",
    `${totalChanges} changes detected in your watched programs:`,
    "",
  ];
  for (const group of shownGroups) {
    lines.push(`${group.programName} (${group.changes.length} changes)`);
    const shown = group.changes.slice(0, assetCap);
    for (const change of shown) {
      lines.push(changeLine(change));
    }
    const hidden = group.changes.length - shown.length;
    if (hidden > 0) {
      lines.push(`  ... and ${hidden} more asset${hidden === 1 ? "" : "s"}`);
    }
    lines.push("");
  }
  if (hiddenPrograms > 0) {
    lines.push(
      `... and ${hiddenPrograms} more program${hiddenPrograms === 1 ? "" : "s"}`,
    );
    lines.push("");
  }
  if (shownChanges < totalChanges) {
    lines.push(`(Showing ${shownChanges} of ${totalChanges} changes)`);
    lines.push("");
  }
  lines.push(footer(options.frontendUrl, options.unsubscribeUrl));
  return { subject, text: lines.join("\n") };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDigestDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()] ?? "?";
  const day = date.getUTCDate();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

export function renderDaily(
  changes: TemplateChange[],
  options: RenderOptions & { windowStart: Date; windowEnd: Date },
): RenderedMail {
  const programCap = options.programCap ?? DEFAULT_PROGRAM_CAP;
  if (changes.length === 0) {
    return {
      subject: "[Anveshan] Daily digest — no changes",
      text: [
        "Hi,",
        "",
        "No changes in your watched programs.",
        "",
        footer(options.frontendUrl, options.unsubscribeUrl),
      ].join("\n"),
    };
  }
  const groups = groupByProgram(changes);
  const shownGroups = groups.slice(0, programCap);
  const hiddenPrograms = groups.length - shownGroups.length;
  const assetEvents = changes.filter((c) => c.type !== "PROGRAM_ADDED").length;

  const subject = `[Anveshan] Daily digest — ${groups.length} program${groups.length === 1 ? "" : "s"} changed (${assetEvents} assets)`;
  const lines = [
    "Hi,",
    "",
    `In the last 24 hours (${formatDigestDate(options.windowStart)} → ${formatDigestDate(options.windowEnd)} UTC):`,
    "",
  ];
  for (const group of shownGroups) {
    lines.push(group.programName);
    if (group.changes.some((c) => c.type === "PROGRAM_ADDED")) {
      lines.push("  + New program");
    }
    const added = group.changes.filter((c) => c.type === "ASSET_ADDED").length;
    const removed = group.changes.filter((c) => c.type === "ASSET_REMOVED").length;
    const parts: string[] = [];
    if (added > 0) parts.push(`+ ${added} asset${added === 1 ? "" : "s"} added`);
    if (removed > 0) parts.push(`- ${removed} asset${removed === 1 ? "" : "s"} removed`);
    if (parts.length > 0) lines.push(`  ${parts.join(", ")}`);
    lines.push("");
  }
  if (hiddenPrograms > 0) {
    lines.push(
      `... and ${hiddenPrograms} more program${hiddenPrograms === 1 ? "" : "s"}`,
    );
    lines.push("");
  }
  lines.push(footer(options.frontendUrl, options.unsubscribeUrl));
  return { subject, text: lines.join("\n") };
}
