import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";

export { HubspotError, isHubspotError } from "./client";
export type { HubspotErrorCode } from "./client";

const hubspotContactResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  properties: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().optional(),
});

export type UpsertHubspotContactInput = HubspotClientOptions &
  Readonly<{
    email: string;
    properties: Readonly<Record<string, string | null | undefined>>;
  }>;

export type UpsertHubspotContactResult = z.infer<typeof hubspotContactResponseSchema>;

/**
 * Compatibility adapter for the historical contact push.
 *
 * This is an update-by-email PATCH and cannot create a missing contact. New delivery code should
 * use batchUpsertHubspotContacts with a custom unique property instead.
 */
export async function upsertHubspotContact(
  input: UpsertHubspotContactInput,
): Promise<UpsertHubspotContactResult> {
  const email = z.string().trim().email().parse(input.email);
  const properties = Object.fromEntries(
    Object.entries(input.properties).flatMap(([rawName, rawValue]) => {
      const name = rawName.trim();
      if (!name) {
        throw new HubspotError(
          "HUBSPOT_INVALID_INPUT",
          400,
          "HubSpot property names must not be empty",
          { retryable: false },
        );
      }
      if (typeof rawValue !== "string" || rawValue.trim() === "") {
        return [];
      }
      return [[name, rawValue]];
    }),
  );

  return hubspotRequest({
    ...input,
    method: "PATCH",
    path: `/crm/objects/${HUBSPOT_API_VERSION}/contacts/${encodeURIComponent(email)}?idProperty=email`,
    body: { properties },
    responseSchema: hubspotContactResponseSchema,
  });
}
