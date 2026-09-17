import { z } from "zod";

// HackerOne Hacker API v1 is JSON:API shaped. Schemas stay lenient
// (unknown fields stripped) so additive API changes do not break us.

const linksSchema = z
  .object({
    next: z.string().nullable().optional(),
    last: z.string().nullable().optional(),
  })
  .passthrough();

const programAttributesSchema = z
  .object({
    handle: z.string(),
    name: z.string(),
  })
  .passthrough();

export const programItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    attributes: programAttributesSchema,
  })
  .passthrough();

export const programsResponseSchema = z
  .object({
    data: z.array(programItemSchema),
    links: linksSchema.optional(),
  })
  .passthrough();

export type ProgramsResponse = z.infer<typeof programsResponseSchema>;

const scopeAttributesSchema = z
  .object({
    asset_type: z.string().optional(),
    asset_identifier: z.string().optional(),
    eligible_for_bounty: z.boolean().optional(),
    eligible_for_submission: z.boolean().optional(),
  })
  .passthrough();

export const scopeItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    attributes: scopeAttributesSchema,
  })
  .passthrough();

export const scopesResponseSchema = z
  .object({
    data: z.array(scopeItemSchema),
    links: linksSchema.optional(),
  })
  .passthrough();

export type ScopesResponse = z.infer<typeof scopesResponseSchema>;
