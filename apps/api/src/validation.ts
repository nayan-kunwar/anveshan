import { z } from "zod";
import { isValidTimezone } from "@anveshan/notifications";

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = (def: number): z.ZodDefault<z.ZodNumber> =>
  z.coerce.number().int().min(1).max(100).default(def);

export const programsQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema(25),
  q: z.string().trim().max(100).optional(),
});

export type ProgramsQuery = z.infer<typeof programsQuerySchema>;

export const programIdParamSchema = z.object({
  id: z.string().uuid("Program id must be a UUID"),
});

// --- Manual admin collection trigger ---

export const adminRecentRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type AdminRecentRunsQuery = z.infer<typeof adminRecentRunsQuerySchema>;

// --- Admin scheduler control (POST body semantics; cron/tz validity is
// checked in the controller so every path shares one validator). ---

export const schedulerBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    cron: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "Provide at least one of enabled, cron, timezone",
  });

export type SchedulerBody = z.infer<typeof schedulerBodySchema>;

export const assetsQuerySchema = z.object({
  scope: z.enum(["ALL", "IN", "OUT"]).default("ALL"),
  page: pageSchema,
  pageSize: pageSizeSchema(100),
});

export type AssetsQuery = z.infer<typeof assetsQuerySchema>;

export const changesQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema(100),
});

export type ChangesQuery = z.infer<typeof changesQuerySchema>;

export const globalChangesQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  type: z.enum(["PROGRAM_ADDED", "ASSET_ADDED", "ASSET_REMOVED"]).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema(100),
});

export type GlobalChangesQuery = z.infer<typeof globalChangesQuerySchema>;

// --- Milestone 2: auth ---

export const requestMagicLinkSchema = z.object({
  email: z.string().email("Email must be valid").max(320),
});

export type RequestMagicLinkBody = z.infer<typeof requestMagicLinkSchema>;

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1, "Token is required").max(256),
});

export type VerifyMagicLinkBody = z.infer<typeof verifyMagicLinkSchema>;

export const unsubscribeSchema = z.object({
  userId: z.string().uuid("userId must be a UUID"),
  token: z.string().min(1, "Token is required").max(256),
});

export type UnsubscribeBody = z.infer<typeof unsubscribeSchema>;

// --- Milestone 2: subscriptions ---

export const subscriptionBodySchema = z.object({
  frequency: z.enum(["immediate", "daily"]),
  watchNewPrograms: z.boolean(),
  watchAllPrograms: z.boolean(),
  // Daily close preference (IANA timezone + 24h HH:MM). Optional:
  // omitted fields leave stored values unchanged. Ignored for
  // immediate delivery but stored anyway.
  digestTimezone: z
    .string()
    .min(1, "Timezone is required")
    .max(64)
    .refine((tz) => isValidTimezone(tz), "Unknown timezone")
    .optional(),
  digestTimeLocal: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use HH:MM, 24-hour")
    .optional(),
});

export type SubscriptionBody = z.infer<typeof subscriptionBodySchema>;

export const watchBodySchema = z.object({
  programId: z.string().uuid("programId must be a UUID"),
});

export type WatchBody = z.infer<typeof watchBodySchema>;

export const watchParamSchema = z.object({
  programId: z.string().uuid("programId must be a UUID"),
});
