import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";
import {
  fetchHubspotAssociationDetails,
  type HubspotReadAssociation,
} from "./custom-objects";

const associationCategorySchema = z.enum([
  "HUBSPOT_DEFINED",
  "USER_DEFINED",
  "INTEGRATOR_DEFINED",
  "WORK",
]);

const associationLabelSchema = z.object({
  category: associationCategorySchema,
  typeId: z.number().int().positive(),
  label: z.string().nullable(),
});

const associationLabelsResponseSchema = z.object({
  results: z.array(associationLabelSchema),
});

const batchAssociationResultSchema = z.object({
  fromObjectId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  fromObjectTypeId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  labels: z.array(z.string()),
  toObjectId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  toObjectTypeId: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

const batchAssociationErrorSchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  message: z.string().optional(),
  context: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        code: z.string().optional(),
        message: z.string().optional(),
        context: z.unknown().optional(),
      }),
    )
    .optional(),
});

const batchAssociationResponseSchema = z.object({
  status: z.string().optional(),
  results: z.array(batchAssociationResultSchema),
  numErrors: z.number().int().nonnegative().optional(),
  errors: z.array(batchAssociationErrorSchema).default([]),
});

export type HubspotAssociationCategory = z.infer<typeof associationCategorySchema>;
export type HubspotAssociationLabel = z.infer<typeof associationLabelSchema>;

export type FetchHubspotAssociationLabelsInput = HubspotClientOptions &
  Readonly<{
    fromObjectType: string;
    toObjectType: string;
  }>;

export type HubspotAssociationCreateInput = Readonly<{
  fromId: string;
  toId: string;
  associationTypeId: number;
  associationCategory: HubspotAssociationCategory;
}>;

export type CreateHubspotAssociationsInput = HubspotClientOptions &
  Readonly<{
    fromObjectType: string;
    toObjectType: string;
    associations: readonly HubspotAssociationCreateInput[];
    preserveExistingLabels?: boolean;
  }>;

export type HubspotAssociationBatchError = Readonly<{
  inputIndex: number;
  chunkIndex: number;
  category: string | null;
  code: string | null;
  message: string;
}>;

export type HubspotAssociationCreateOutcome = Readonly<{
  inputIndex: number;
  fromId: string;
  toId: string;
  success: boolean;
  error: HubspotAssociationBatchError | null;
}>;

export type CreateHubspotAssociationsResult = Readonly<{
  submitted: number;
  accepted: number;
  errors: HubspotAssociationBatchError[];
  outcomes: HubspotAssociationCreateOutcome[];
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

function safeBatchErrorDetails(
  error: z.infer<typeof batchAssociationErrorSchema>,
): Omit<HubspotAssociationBatchError, "inputIndex" | "chunkIndex"> {
  return {
    category: error.category ?? null,
    code: error.errors?.find((item) => item.code)?.code ?? null,
    message: (
      error.message ??
      error.errors?.find((item) => item.message)?.message ??
      "HubSpot rejected an association"
    )
      .trim()
      .slice(0, 500),
  };
}

function errorContextContains(
  value: unknown,
  expected: string,
  depth = 0,
): boolean {
  if (depth > 5 || value === null || typeof value === "undefined") {
    return false;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value) === expected;
  }
  if (Array.isArray(value)) {
    return value.some((item) => errorContextContains(item, expected, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value).some((item) =>
      errorContextContains(item, expected, depth + 1));
  }
  return false;
}

function errorMatchesAssociation(
  error: z.infer<typeof batchAssociationErrorSchema>,
  association: { fromId: string; toId: string },
): boolean {
  const contexts = [error.context, ...(error.errors?.map((item) => item.context) ?? [])];
  return contexts.some(
    (context) =>
      errorContextContains(context, association.fromId)
      && errorContextContains(context, association.toId),
  );
}

export function findHubspotAssociationLabel(
  labels: readonly HubspotAssociationLabel[],
  expectedLabel: string | null,
  category?: HubspotAssociationCategory,
): HubspotAssociationLabel | null {
  const matches = labels.filter(
    (candidate) =>
      candidate.label === expectedLabel &&
      (typeof category === "undefined" || candidate.category === category),
  );
  if (matches.length > 1) {
    throw new HubspotError(
      "HUBSPOT_INVALID_RESPONSE",
      502,
      "HubSpot returned ambiguous association labels",
      { retryable: false },
    );
  }
  return matches[0] ?? null;
}

export async function fetchHubspotAssociationLabels(
  input: FetchHubspotAssociationLabelsInput,
): Promise<HubspotAssociationLabel[]> {
  const fromObjectType = nonBlank(input.fromObjectType, "source object type");
  const toObjectType = nonBlank(input.toObjectType, "target object type");
  const response = await hubspotRequest({
    ...input,
    path: `/crm/associations/${HUBSPOT_API_VERSION}/${encodeURIComponent(fromObjectType)}/${encodeURIComponent(toObjectType)}/labels`,
    responseSchema: associationLabelsResponseSchema,
  });
  return response.results;
}

export async function createHubspotAssociations(
  input: CreateHubspotAssociationsInput,
): Promise<CreateHubspotAssociationsResult> {
  const fromObjectType = nonBlank(input.fromObjectType, "source object type");
  const toObjectType = nonBlank(input.toObjectType, "target object type");
  if (input.associations.length === 0) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "HubSpot association creation requires records",
      { retryable: false },
    );
  }

  const normalized = input.associations.map((association) => {
    if (!Number.isInteger(association.associationTypeId) || association.associationTypeId < 1) {
      throw new HubspotError(
        "HUBSPOT_INVALID_INPUT",
        400,
        "HubSpot association type ID must be a positive integer",
        { retryable: false },
      );
    }
    return {
      fromId: nonBlank(association.fromId, "source record ID"),
      toId: nonBlank(association.toId, "target record ID"),
      associationTypeId: association.associationTypeId,
      associationCategory: association.associationCategory,
    };
  });

  let accepted = 0;
  const errors: HubspotAssociationBatchError[] = [];
  const outcomes: HubspotAssociationCreateOutcome[] = [];
  const clientOptions: HubspotClientOptions = input;
  for (let chunkStart = 0; chunkStart < normalized.length; chunkStart += 2000) {
    const chunk = normalized.slice(chunkStart, chunkStart + 2000);
    const existingByFromId = new Map<string, HubspotReadAssociation[]>();
    if (input.preserveExistingLabels === true) {
      const fromIds = [...new Set(chunk.map((association) => association.fromId))];
      for (let readStart = 0; readStart < fromIds.length; readStart += 1000) {
        const details = await fetchHubspotAssociationDetails({
          ...clientOptions,
          fromObjectType,
          toObjectType,
          objectIds: fromIds.slice(readStart, readStart + 1000),
        });
        for (const [fromId, associations] of details) {
          existingByFromId.set(fromId, associations);
        }
      }
    }
    const response = await hubspotRequest({
      ...input,
      method: "POST",
      path: `/crm/associations/${HUBSPOT_API_VERSION}/${encodeURIComponent(fromObjectType)}/${encodeURIComponent(toObjectType)}/batch/create`,
      body: {
        inputs: chunk.map((association) => {
          const types = new Map<string, {
            associationCategory: HubspotAssociationCategory;
            associationTypeId: number;
          }>();
          const addType = (
            associationCategory: HubspotAssociationCategory,
            associationTypeId: number,
          ) => {
            types.set(`${associationCategory}:${associationTypeId}`, {
              associationCategory,
              associationTypeId,
            });
          };
          addType(association.associationCategory, association.associationTypeId);
          const existingPair = existingByFromId
            .get(association.fromId)
            ?.find((candidate) => candidate.toObjectId === association.toId);
          for (const existingType of existingPair?.associationTypes ?? []) {
            const category = associationCategorySchema.safeParse(existingType.category);
            if (category.success) {
              addType(category.data, existingType.typeId);
            }
          }
          return {
            from: { id: association.fromId },
            to: { id: association.toId },
            types: [...types.values()],
          };
        }),
      },
      responseSchema: batchAssociationResponseSchema,
      acceptedStatuses: [200, 207],
    });

    const chunkIndex = Math.floor(chunkStart / 2000);
    const successfulPairs = new Map<string, number>();
    for (const result of response.results) {
      const key = `${result.fromObjectId}\u0000${result.toObjectId}`;
      successfulPairs.set(key, (successfulPairs.get(key) ?? 0) + 1);
    }
    const reportedErrors = response.numErrors ?? response.errors.length;
    let failureOffset = 0;

    for (let offset = 0; offset < chunk.length; offset += 1) {
      const association = chunk[offset]!;
      const inputIndex = chunkStart + offset;
      const key = `${association.fromId}\u0000${association.toId}`;
      const remainingSuccesses = successfulPairs.get(key) ?? 0;
      if (remainingSuccesses > 0) {
        successfulPairs.set(key, remainingSuccesses - 1);
        accepted += 1;
        outcomes.push({
          inputIndex,
          fromId: association.fromId,
          toId: association.toId,
          success: true,
          error: null,
        });
        continue;
      }

      const providerErrorPayload = response.errors.find((error) =>
        errorMatchesAssociation(error, association))
        ?? response.errors[failureOffset]
        ?? response.errors[0];
      const providerError = providerErrorPayload
        ? safeBatchErrorDetails(providerErrorPayload)
        : null;
      failureOffset += 1;
      const error: HubspotAssociationBatchError = {
        inputIndex,
        chunkIndex,
        category: providerError?.category ?? "PARTIAL_RESPONSE",
        code: providerError?.code ?? "ASSOCIATION_NOT_CONFIRMED",
        message: providerError?.message
          ?? (reportedErrors > 0
            ? "HubSpot rejected the association without row-level error details"
            : "HubSpot did not confirm the submitted association"),
      };
      errors.push(error);
      outcomes.push({
        inputIndex,
        fromId: association.fromId,
        toId: association.toId,
        success: false,
        error,
      });
    }
  }

  return { submitted: normalized.length, accepted, errors, outcomes };
}
