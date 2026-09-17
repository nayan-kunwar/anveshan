import { z } from "zod";

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = (def: number): z.ZodDefault<z.ZodNumber> =>
  z.coerce.number().int().min(1).max(100).default(def);

export const programsQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema(25),
});

export type ProgramsQuery = z.infer<typeof programsQuerySchema>;

export const programIdParamSchema = z.object({
  id: z.string().uuid("Program id must be a UUID"),
});

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
