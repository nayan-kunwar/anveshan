import { initLocalEnv, loadConfig } from "@anveshan/config";
import {
  addWatch,
  closePool,
  completeRun,
  createDb,
  createRun,
  findSubscription,
  findUserByEmail,
  getPool,
  insertChange,
  notificationDeliveries,
  programs,
  upsertAsset,
  upsertProgram,
  upsertSubscription,
} from "@anveshan/database";
import { createMailer } from "@anveshan/notifications";
import { lastClose } from "@anveshan/notifications";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { createLogger } from "./logger.js";
import { enqueueDueDigests, enqueueImmediate } from "./notifications/enqueue.js";
import { createDeliveryWorker } from "./notifications/worker.js";

/**
 * Reusable dev-only instant mail tester. No HackerOne, no cron wait:
 * writes a synthetic collection run + changes for a (default zz-*)
 * program, enqueues, and drains the outbox once with real SMTP.
 *
 * Positive paths mirror apps/api/test/notifications.test.ts helpers.
 * Daily/negative runs complete with zero counters on purpose: the
 * worker's catchUpImmediate only picks up runs reporting changes, so
 * zero counters isolate the digest path (or silence, for negatives)
 * from immediate catch-up. Documented in docs/development.md.
 *
 * The daily positive path temporarily aligns the target's digest close
 * to now and restores their real prefs afterwards (success or failure).
 */

type Cadence = "immediate" | "daily";
type ChangeType = "PROGRAM_ADDED" | "ASSET_ADDED" | "ASSET_REMOVED";

interface Options {
  email: string;
  handle: string;
  types: ChangeType[];
  cadence: Cadence;
  watch: "watch-all" | "specific";
  negative: boolean;
  asset: string | null;
  count: number;
  cleanup: boolean;
  yes: boolean;
}

function usage(): string {
  return [
    "pnpm mail:test -- --email <addr> --yes [options]",
    "  --handle <h>     test program handle (default zz-test-mail)",
    "  --types <list>   comma subset of PROGRAM_ADDED,ASSET_ADDED,ASSET_REMOVED",
    "  --cadence <c>    immediate (default) | daily",
    "  --watch <w>      watch-all (default) | specific (adds a watch row)",
    "  --negative       no-match test: expects 0 mails, sends nothing to target",
    "  --asset <a>      base asset identifier (default instant-test-<ts>.example.com)",
    "  --count <n>      asset lines per asset type, 1..30 (default 1; >10 proves caps)",
    "  --cleanup        default ON; --no-cleanup keeps the test program",
    "  --yes            required: confirm real SMTP send",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | null => {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === `--${name}`) return argv[i + 1] ?? null;
      if (arg !== undefined && arg.startsWith(`--${name}=`))
        return arg.slice(name.length + 3);
    }
    return null;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const email = get("email") ?? "";
  const rawHandle = get("handle") ?? "zz-test-mail";
  const handle = rawHandle.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(handle)) {
    throw new Error(
      `invalid --handle ${rawHandle}: use lowercase letters/digits/hyphens`,
    );
  }
  const typesRaw = (get("types") ?? "PROGRAM_ADDED,ASSET_ADDED").toUpperCase();
  const types = typesRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean) as ChangeType[];
  const allowed: ChangeType[] = ["PROGRAM_ADDED", "ASSET_ADDED", "ASSET_REMOVED"];
  if (types.length === 0 || !types.every((t) => allowed.includes(t))) {
    throw new Error(`invalid --types ${typesRaw}: subset of ${allowed.join(",")}`);
  }
  const cadenceRaw = get("cadence") ?? "immediate";
  if (cadenceRaw !== "immediate" && cadenceRaw !== "daily") {
    throw new Error(`invalid --cadence ${cadenceRaw}: immediate|daily`);
  }
  const cadence: Cadence = cadenceRaw;
  const watchRaw = get("watch") ?? "watch-all";
  if (watchRaw !== "watch-all" && watchRaw !== "specific") {
    throw new Error(`invalid --watch ${watchRaw}: watch-all|specific`);
  }
  const watch: Options["watch"] = watchRaw;
  const count = Number(get("count") ?? "1");
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    throw new Error(`invalid --count ${get("count")}: integer 1..30`);
  }
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw new Error("missing/invalid --email\n" + usage());

  return {
    email: email.toLowerCase(),
    handle,
    types,
    cadence,
    watch,
    negative: has("negative"),
    asset: get("asset"),
    count,
    cleanup: !has("no-cleanup"),
    yes: has("yes"),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  initLocalEnv(import.meta.url);
  const config = loadConfig();
  const logger = createLogger({ LOG_LEVEL: config.LOG_LEVEL });

  if (process.env["NODE_ENV"] === "production") {
    throw new Error("mail:test is dev-only (NODE_ENV=production)");
  }
  if (!config.NOTIFICATIONS_ENABLED)
    throw new Error("NOTIFICATIONS_ENABLED must be true");
  if (!config.SMTP_FROM) throw new Error("SMTP_FROM must be set for real mail");
  if (config.MAIL_PROVIDER === "brevo") {
    if (!config.BREVO_API_KEY)
      throw new Error("BREVO_API_KEY must be set when MAIL_PROVIDER=brevo");
  } else if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    throw new Error("SMTP_HOST/USER/PASS must be set when MAIL_PROVIDER=smtp");
  }
  if (!config.UNSUBSCRIBE_SECRET) throw new Error("UNSUBSCRIBE_SECRET must be set");

  if (!opts.yes) {
    process.stdout.write(
      `dry-run (pass --yes to send real mail):\n${JSON.stringify({ ...opts, yes: undefined }, null, 2)}\n${usage()}\n`,
    );
    return;
  }

  const pool = getPool(config.DATABASE_URL);
  const db = createDb(pool);
  let programId: string | null = null;
  try {
    const user = await findUserByEmail(db, opts.email);
    if (!user) throw new Error(`user not found: ${opts.email}`);
    if (!user.emailVerifiedAt) throw new Error(`user not verified: ${opts.email}`);
    if (user.unsubscribedAt) throw new Error(`user is unsubscribed: ${opts.email}`);
    const sub = await findSubscription(db, user.id);
    if (!sub) throw new Error("no subscriptions row — save the dashboard first");
    logger.info(
      {
        frequency: sub.frequency,
        watchNew: sub.watchNewPrograms,
        watchAll: sub.watchAllPrograms,
      },
      "subscription ok",
    );

    if (!opts.negative && sub.frequency !== opts.cadence) {
      throw new Error(
        `target user is on '${sub.frequency}': switch dashboard Frequency to '${opts.cadence}' + Save, then re-run (negatives use the opposite cadence on purpose)`,
      );
    }

    const sendMail = createMailer({
      provider: config.MAIL_PROVIDER,
      from: config.SMTP_FROM,
      timeoutMs: config.MAIL_SEND_TIMEOUT_MS,
      smtp: config.SMTP_HOST
        ? {
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          }
        : undefined,
      brevo: config.BREVO_API_KEY
        ? { apiKey: config.BREVO_API_KEY, apiUrl: config.BREVO_API_URL }
        : undefined,
    });
    const worker = createDeliveryWorker({ db, config, logger, sendMail });

    if (opts.negative) {
      // No-match test via opposite-cadence enqueue: targets the cadence the
      // user is NOT on, so the target user can never match. Zero counters
      // keep immediate catch-up from picking the run up either.
      const probeProgram = await upsertProgram(db, {
        platform: "hackerone",
        externalId: opts.handle,
        name: `ZZ Test ${opts.handle}`,
      });
      programId = probeProgram.id;
      const run = await createRun(db);
      await insertChange(db, {
        type: "ASSET_ADDED",
        programId,
        assetId: null,
        assetKey: "URL|no-match-probe.example.com",
        assetIdentifier: "no-match-probe.example.com",
        collectionRunId: run.id,
      });
      await completeRun(db, run.id, {
        programsSeen: 1,
        assetsSeen: 1,
        programsAdded: 0,
        assetsAdded: 0,
        assetsRemoved: 0,
      });
      if (sub.frequency === "immediate") {
        const now = new Date();
        const close = lastClose(now, sub.digestTimezone, sub.digestTimeLocal);
        if (!close) throw new Error("no closed digest window");
        await db.execute(sql`
          UPDATE changes SET detected_at = ${new Date(close.getTime() - 3_600_000)}
          WHERE collection_run_id = ${run.id}`);
        await enqueueDueDigests({ db, config, logger }, now);
        const result = await worker.drain();
        const rows = await db
          .select({ id: notificationDeliveries.id })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.userId, user.id),
              eq(notificationDeliveries.kind, "daily"),
            ),
          );
        process.stdout.write(
          `negative (daily-enqueue, user is immediate): deliveries for target=${rows.length} claimed=${result.claimed} sent=${result.sent}\n`,
        );
        if (rows.length > 0)
          throw new Error("negative test failed: target got a delivery");
      } else {
        await enqueueImmediate({ db, config, logger }, run.id);
        const result = await worker.drain();
        const rows = await db
          .select({ id: notificationDeliveries.id })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.userId, user.id),
              eq(notificationDeliveries.collectionRunId, run.id),
            ),
          );
        process.stdout.write(
          `negative (immediate-enqueue, user is daily): deliveries for target=${rows.length} claimed=${result.claimed} sent=${result.sent}\n`,
        );
        if (rows.length > 0)
          throw new Error("negative test failed: target got a delivery");
      }
      process.stdout.write(`run: ${run.id}\nNEGATIVE OK: 0 mails to target\n`);
      return;
    }

    if (
      opts.watch === "watch-all" &&
      !sub.watchAllPrograms &&
      opts.types.some((t) => t !== "PROGRAM_ADDED")
    ) {
      throw new Error(
        "watch_all is off and --watch=watch-all: ASSET_* would match nothing; use --watch specific",
      );
    }
    if (opts.watch === "specific" && sub.watchAllPrograms) {
      logger.warn(
        "watch_all is on: specific-watch branch overlaps (mail still proves delivery, not isolation)",
      );
    }

    const program = await upsertProgram(db, {
      platform: "hackerone",
      externalId: opts.handle,
      name: `ZZ Test ${opts.handle}`,
      url: `https://hackerone.com/${opts.handle}`,
    });
    programId = program.id;
    if (opts.watch === "specific") await addWatch(db, user.id, program.id);

    const base = opts.asset ?? `instant-test-${Date.now()}.example.com`;
    const run = await createRun(db);
    let assetsAdded = 0;
    let assetsRemoved = 0;
    let programsAdded = 0;
    if (opts.types.includes("PROGRAM_ADDED")) {
      programsAdded = 1;
      await insertChange(db, {
        type: "PROGRAM_ADDED",
        programId,
        assetId: null,
        assetKey: null,
        assetIdentifier: null,
        collectionRunId: run.id,
      });
    }
    for (const type of opts.types.filter((t) => t !== "PROGRAM_ADDED")) {
      for (let i = 0; i < opts.count; i += 1) {
        const identifier =
          i === 0 ? base : `${base.replace(/\.example\.com$/, "")}-${i}.example.com`;
        await upsertAsset(db, {
          programId,
          identifier,
          normalizedIdentifier: identifier.toLowerCase(),
          type: "URL",
          scope: type === "ASSET_ADDED" ? "IN" : "OUT",
        });
        await insertChange(db, {
          type,
          programId,
          assetId: null,
          assetKey: `URL|${identifier.toLowerCase()}`,
          assetIdentifier: identifier,
          collectionRunId: run.id,
        });
        if (type === "ASSET_ADDED") assetsAdded += 1;
        else assetsRemoved += 1;
      }
    }
    // Daily runs use zero counters so immediate catch-up skips them and
    // only the digest path fires; immediate runs report honestly.
    const isolateDigest = opts.cadence === "daily";
    await completeRun(db, run.id, {
      programsSeen: 1,
      assetsSeen: assetsAdded + assetsRemoved,
      programsAdded: isolateDigest ? 0 : programsAdded,
      assetsAdded: isolateDigest ? 0 : assetsAdded,
      assetsRemoved: isolateDigest ? 0 : assetsRemoved,
    });

    if (opts.cadence === "immediate") {
      const enqueued = await enqueueImmediate({ db, config, logger }, run.id);
      const result = await worker.drain();
      const rows = await db
        .select({ status: notificationDeliveries.status })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.userId, user.id),
            eq(notificationDeliveries.collectionRunId, run.id),
          ),
        );
      process.stdout.write(
        `run: ${run.id}\nprogram: ${program.id} (${opts.handle})\nenqueued: ${enqueued}\nclaimed: ${result.claimed} sent: ${result.sent} skipped: ${result.skipped}\ndeliveries for target: ${JSON.stringify(rows.map((r) => r.status))}\n`,
      );
      if (!rows.some((r) => r.status === "sent")) {
        throw new Error("no sent delivery for target — check status/last_error");
      }
    } else {
      // Align the target's digest close to right now so the per-minute
      // tick fires deterministically at any hour. Snapshot first: the
      // alignment overwrites the user's real prefs, restored below.
      const origPrefs = {
        frequency: opts.cadence,
        watchNewPrograms: sub.watchNewPrograms,
        watchAllPrograms: sub.watchAllPrograms,
        digestTimezone: sub.digestTimezone,
        digestTimeLocal: sub.digestTimeLocal,
      };
      const now = new Date();
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mi = String(now.getUTCMinutes()).padStart(2, "0");
      await upsertSubscription(db, user.id, {
        ...origPrefs,
        digestTimezone: "UTC",
        digestTimeLocal: `${hh}:${mi}`,
      });
      try {
        const close = lastClose(now, "UTC", `${hh}:${mi}`);
        if (!close) throw new Error("no closed digest window");
        await db.execute(sql`
          UPDATE changes SET detected_at = ${new Date(close.getTime() - 3_600_000)}
          WHERE collection_run_id = ${run.id}`);
        const enqueued = await enqueueDueDigests({ db, config, logger }, now);
        const result = await worker.drain();
        const rows = await db
          .select({ status: notificationDeliveries.status })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.userId, user.id),
              eq(notificationDeliveries.kind, "daily"),
            ),
          );
        process.stdout.write(
          `run: ${run.id}\nclose: ${close.toISOString()}\nprogram: ${program.id} (${opts.handle})\nenqueued: ${enqueued}\nclaimed: ${result.claimed} sent: ${result.sent} skipped: ${result.skipped}\ndeliveries for target: ${JSON.stringify(rows.map((r) => r.status))}\n`,
        );
        if (!rows.some((r) => r.status === "sent")) {
          throw new Error("no sent digest for target — check status/last_error");
        }
      } finally {
        await upsertSubscription(db, user.id, origPrefs);
        process.stdout.write(
          `restored subscription prefs (${origPrefs.digestTimeLocal} ${origPrefs.digestTimezone})\n`,
        );
      }
    }
  } finally {
    if (programId && opts.cleanup) {
      const db2 = createDb(pool);
      await db2.delete(programs).where(eq(programs.id, programId));
      process.stdout.write(`cleanup: deleted test program ${opts.handle}\n`);
    } else if (programId) {
      process.stdout.write(`kept test program ${opts.handle} (--no-cleanup)\n`);
    }
    await closePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mail:test failed: ${message}\n`);
  process.exitCode = 1;
});
