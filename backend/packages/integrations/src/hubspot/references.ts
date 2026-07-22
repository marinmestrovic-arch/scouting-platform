import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";

const pagingSchema = z
  .object({
    next: z
      .object({
        after: z.union([z.string(), z.number()]).transform((value) => String(value)),
        link: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const hubspotOwnerSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  email: z.string().email().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  userId: z.union([z.string(), z.number()]).transform((value) => String(value)).nullable().optional(),
  userIdIncludingInactive: z
    .union([z.string(), z.number()])
    .transform((value) => String(value))
    .nullable()
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().default(false),
  teams: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform((value) => String(value)),
        name: z.string().optional(),
        primary: z.boolean().optional(),
      }),
    )
    .default([]),
});

const hubspotOwnersResponseSchema = z.object({
  results: z.array(hubspotOwnerSchema),
  paging: pagingSchema,
});

const hubspotPipelineStageSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  label: z.string(),
  displayOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().default(false),
  writePermissions: z.string().optional(),
});

const hubspotPipelineSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  label: z.string(),
  displayOrder: z.number().int().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().default(false),
  stages: z.array(hubspotPipelineStageSchema).default([]),
});

const hubspotPipelinesResponseSchema = z.object({
  results: z.array(hubspotPipelineSchema),
});

export type HubspotOwner = z.infer<typeof hubspotOwnerSchema>;
export type HubspotPipelineStage = z.infer<typeof hubspotPipelineStageSchema>;
export type HubspotPipeline = z.infer<typeof hubspotPipelineSchema>;

export type FetchHubspotOwnersInput = HubspotClientOptions &
  Readonly<{
    after?: string;
    limit?: number;
    archived?: boolean;
    email?: string;
  }>;

export type FetchHubspotOwnersResult = Readonly<{
  results: HubspotOwner[];
  nextAfter: string | null;
}>;

export type FetchHubspotPipelinesInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    archived?: boolean;
  }>;

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, `HubSpot ${field} must not be empty`, {
      retryable: false,
    });
  }
  return trimmed;
}

export async function fetchHubspotOwners(
  input: FetchHubspotOwnersInput = {},
): Promise<FetchHubspotOwnersResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "HubSpot owners limit must be between 1 and 500",
      { retryable: false },
    );
  }
  const url = new URL(`/crm/owners/${HUBSPOT_API_VERSION}`, "https://hubspot.invalid");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  if (input.after?.trim()) {
    url.searchParams.set("after", input.after.trim());
  }
  if (input.email?.trim()) {
    url.searchParams.set("email", input.email.trim());
  }

  const response = await hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotOwnersResponseSchema,
  });
  return {
    results: response.results,
    nextAfter: response.paging?.next?.after ?? null,
  };
}

export async function fetchHubspotPipelines(
  input: FetchHubspotPipelinesInput,
): Promise<HubspotPipeline[]> {
  const objectType = nonBlank(input.objectType, "pipeline object type");
  const url = new URL(
    `/crm/pipelines/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}`,
    "https://hubspot.invalid",
  );
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  const response = await hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotPipelinesResponseSchema,
  });
  return response.results;
}
