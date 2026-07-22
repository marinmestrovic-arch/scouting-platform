import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";
import {
  fetchHubspotObjectPage,
  hubspotObjectRecordSchema,
} from "./objects";

const hubspotObjectSchema = z.object({
  objectTypeId: z.string().trim().min(1),
  fullyQualifiedName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  primaryDisplayProperty: z.string().optional(),
  secondaryDisplayProperties: z.array(z.string()).default([]),
  labels: z
    .object({
      singular: z.string().optional(),
      plural: z.string().optional(),
    })
    .optional(),
  properties: z.array(z.record(z.string(), z.unknown())).default([]),
  associations: z.array(z.record(z.string(), z.unknown())).default([]),
  archived: z.boolean().default(false),
});

const hubspotObjectSchemasResponseSchema = z.object({
  results: z.array(hubspotObjectSchema),
});

const hubspotAssociationTypeSchema = z.object({
  typeId: z.number().int().positive(),
  category: z.string().optional(),
  label: z.string().nullable().optional(),
});

const hubspotAssociationsResponseSchema = z.object({
  results: z
    .array(
      z.object({
        from: z.object({
          id: z.union([z.string(), z.number()]).transform((value) => String(value)),
        }),
        to: z
          .array(
            z.object({
              toObjectId: z
                .union([z.string(), z.number()])
                .transform((value) => String(value)),
              associationTypes: z.array(hubspotAssociationTypeSchema).default([]),
            }),
          )
          .default([]),
      }),
    ),
});

export type HubspotObjectSchema = z.infer<typeof hubspotObjectSchema>;
export type HubspotCustomObjectRecord = z.infer<typeof hubspotObjectRecordSchema>;
export type HubspotCustomObject = HubspotCustomObjectRecord;
export type FetchHubspotObjectSchemasInput = HubspotClientOptions;

export type FetchHubspotCustomObjectsInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    properties?: readonly string[];
    archived?: boolean;
    after?: string;
    limit?: number;
  }>;

export type FetchHubspotAssociationsInput = HubspotClientOptions &
  Readonly<{
    fromObjectType: string;
    toObjectType: string;
    objectIds: readonly string[];
    associationTypeId?: number;
  }>;

export type FetchHubspotCustomObjectsResult = Readonly<{
  results: HubspotCustomObjectRecord[];
  nextAfter: string | null;
}>;

export type HubspotReadAssociation = Readonly<{
  toObjectId: string;
  associationTypes: Array<z.infer<typeof hubspotAssociationTypeSchema>>;
}>;

export type HubspotAssociationDetailsMap = Map<string, HubspotReadAssociation[]>;
export type HubspotAssociationMap = Map<string, string[]>;

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, `HubSpot ${field} must not be empty`, {
      retryable: false,
    });
  }
  return trimmed;
}

export async function fetchHubspotObjectSchemas(
  input: FetchHubspotObjectSchemasInput = {},
): Promise<HubspotObjectSchema[]> {
  const response = await hubspotRequest({
    ...input,
    path: `/crm-object-schemas/${HUBSPOT_API_VERSION}/schemas`,
    responseSchema: hubspotObjectSchemasResponseSchema,
  });
  return response.results;
}

export async function fetchHubspotCustomObjects(
  input: FetchHubspotCustomObjectsInput,
): Promise<FetchHubspotCustomObjectsResult> {
  const result = await fetchHubspotObjectPage(input);
  return { results: result.results, nextAfter: result.nextAfter };
}

export async function fetchHubspotAssociationDetails(
  input: FetchHubspotAssociationsInput,
): Promise<HubspotAssociationDetailsMap> {
  const fromObjectType = nonBlank(input.fromObjectType, "source object type");
  const toObjectType = nonBlank(input.toObjectType, "target object type");
  if (input.objectIds.length < 1 || input.objectIds.length > 1000) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "HubSpot association reads require between 1 and 1000 record IDs",
      { retryable: false },
    );
  }
  const objectIds = input.objectIds.map((id) => nonBlank(id, "association record ID"));
  const response = await hubspotRequest({
    ...input,
    method: "POST",
    path: `/crm/associations/${HUBSPOT_API_VERSION}/${encodeURIComponent(fromObjectType)}/${encodeURIComponent(toObjectType)}/batch/read`,
    body: { inputs: objectIds.map((id) => ({ id })) },
    responseSchema: hubspotAssociationsResponseSchema,
  });
  return new Map(
    response.results.map((result) => [
      result.from.id,
      result.to.map((association) => ({
        toObjectId: association.toObjectId,
        associationTypes: association.associationTypes,
      })),
    ]),
  );
}

export async function fetchHubspotAssociations(
  input: FetchHubspotAssociationsInput,
): Promise<HubspotAssociationMap> {
  const details = await fetchHubspotAssociationDetails(input);
  return new Map(
    [...details.entries()].map(([fromId, associations]) => [
      fromId,
      associations
        .filter((association) =>
          typeof input.associationTypeId === "number"
            ? association.associationTypes.some(
                (type) => type.typeId === input.associationTypeId,
              )
            : true,
        )
        .map((association) => association.toObjectId),
    ]),
  );
}
