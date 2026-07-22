import { createHash } from "node:crypto";

import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";

export const hubspotObjectRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  properties: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().default(false),
  archivedAt: z.string().nullable().optional(),
  url: z.string().url().optional(),
  objectWriteTraceId: z.string().trim().min(1).optional(),
});

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

const hubspotObjectPageResponseSchema = z.object({
  results: z.array(hubspotObjectRecordSchema),
  total: z.number().int().nonnegative().optional(),
  paging: pagingSchema,
});

const batchUpsertSuccessSchema = hubspotObjectRecordSchema.extend({
  new: z.boolean().optional(),
  objectWriteTraceId: z.string().trim().min(1),
});

const batchErrorSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  subCategory: z.unknown().optional(),
  message: z.string().optional(),
  objectWriteTraceId: z.string().trim().min(1).optional(),
  context: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        code: z.string().optional(),
        message: z.string().optional(),
        objectWriteTraceId: z.string().trim().min(1).optional(),
        context: z.unknown().optional(),
      }),
    )
    .optional(),
});

const batchUpsertResponseSchema = z.object({
  status: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  results: z.array(batchUpsertSuccessSchema),
  numErrors: z.number().int().nonnegative().optional(),
  errors: z.array(batchErrorSchema).default([]),
});

export type HubspotObjectRecord = z.infer<typeof hubspotObjectRecordSchema>;

export type HubspotObjectPage = Readonly<{
  results: HubspotObjectRecord[];
  nextAfter: string | null;
  total?: number;
}>;

export type HubspotObjectPageInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    properties?: readonly string[];
    associations?: readonly string[];
    archived?: boolean;
    after?: string;
    limit?: number;
  }>;

export type SearchHubspotObjectsUpdatedAfterInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    updatedAfter: Date | number | string;
    modifiedProperty?: string;
    properties?: readonly string[];
    after?: string;
    limit?: number;
  }>;

export type FetchHubspotRecordInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    recordId: string;
    idProperty?: string;
    properties?: readonly string[];
    associations?: readonly string[];
    archived?: boolean;
  }>;

export type BatchReadHubspotObjectsInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    recordIds: readonly string[];
    properties?: readonly string[];
    archived?: boolean;
  }>;

export type HubspotBatchUpsertRecord = Readonly<{
  id: string;
  idProperty: string;
  properties: Readonly<Record<string, string | null | undefined>>;
  objectWriteTraceId?: string;
}>;

export type HubspotBatchUpdateRecord = Readonly<{
  /** HubSpot record ID. The contact batch-update API does not use idProperty for this path. */
  id: string;
  properties: Readonly<Record<string, string | null | undefined>>;
  objectWriteTraceId?: string;
}>;

export type BatchUpsertHubspotObjectsInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    records: readonly HubspotBatchUpsertRecord[];
    /** Awaited after each fully mapped provider chunk, before the next request starts. */
    onChunkComplete?: (checkpoint: HubspotBatchUpsertChunkCheckpoint) => void | Promise<void>;
  }>;

export type BatchUpsertHubspotContactsInput = Omit<
  BatchUpsertHubspotObjectsInput,
  "objectType"
> &
  Readonly<{
    /** Email upsert must be a complete replacement. Partial writes require a custom unique property. */
    allowEmailIdentifierForFullUpsert?: boolean;
  }>;

export type BatchUpsertHubspotDealsInput = Omit<
  BatchUpsertHubspotObjectsInput,
  "objectType"
>;

export type BatchUpdateHubspotObjectsInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    records: readonly HubspotBatchUpdateRecord[];
    /** Awaited after each fully mapped provider chunk, before the next request starts. */
    onChunkComplete?: (checkpoint: HubspotBatchUpsertChunkCheckpoint) => void | Promise<void>;
  }>;

export type BatchUpdateHubspotContactsInput = Omit<
  BatchUpdateHubspotObjectsInput,
  "objectType"
>;

export type HubspotBatchUpsertSuccess = Readonly<{
  inputIndex: number;
  objectWriteTraceId: string;
  success: true;
  id: string;
  created: boolean | null;
  properties: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}>;

export type HubspotBatchUpsertFailure = Readonly<{
  inputIndex: number;
  objectWriteTraceId: string;
  success: false;
  category: string | null;
  code: string | null;
  message: string;
}>;

export type HubspotBatchUpsertOutcome =
  | HubspotBatchUpsertSuccess
  | HubspotBatchUpsertFailure;

export type BatchUpsertHubspotObjectsResult = Readonly<{
  outcomes: HubspotBatchUpsertOutcome[];
  succeeded: number;
  failed: number;
}>;

export type HubspotBatchUpsertChunkCheckpoint = Readonly<{
  chunkIndex: number;
  inputStartIndex: number;
  inputEndIndexExclusive: number;
  outcomes: HubspotBatchUpsertOutcome[];
  succeeded: number;
  failed: number;
}>;

function assertNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      `HubSpot ${field} must not be empty`,
      { retryable: false },
    );
  }
  return trimmed;
}

function assertLimit(value: number | undefined, maximum: number, fallback: number): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      `HubSpot page limit must be between 1 and ${maximum}`,
      { retryable: false },
    );
  }
  return normalized;
}

function appendList(url: URL, name: string, values: readonly string[] | undefined): void {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (normalized.length > 0) {
    url.searchParams.set(name, normalized.join(","));
  }
}

function toTimestamp(value: Date | number | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, "HubSpot sync date is invalid", {
        retryable: false,
      });
    }
    return String(value.getTime());
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, "HubSpot sync timestamp is invalid", {
        retryable: false,
      });
    }
    return String(Math.trunc(value));
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, "HubSpot sync timestamp is invalid", {
      retryable: false,
    });
  }
  return String(parsed);
}

function normalizePage(payload: z.infer<typeof hubspotObjectPageResponseSchema>): HubspotObjectPage {
  return {
    results: payload.results,
    nextAfter: payload.paging?.next?.after ?? null,
    ...(typeof payload.total === "number" ? { total: payload.total } : {}),
  };
}

export async function fetchHubspotObjectPage(
  input: HubspotObjectPageInput,
): Promise<HubspotObjectPage> {
  const objectType = assertNonBlank(input.objectType, "object type");
  const limit = assertLimit(input.limit, 100, 100);
  const url = new URL(
    `/crm/objects/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}`,
    "https://hubspot.invalid",
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  if (input.after?.trim()) {
    url.searchParams.set("after", input.after.trim());
  }
  appendList(url, "properties", input.properties);
  appendList(url, "associations", input.associations);

  const payload = await hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotObjectPageResponseSchema,
  });
  return normalizePage(payload);
}

export async function searchHubspotObjectsUpdatedAfter(
  input: SearchHubspotObjectsUpdatedAfterInput,
): Promise<HubspotObjectPage> {
  const objectType = assertNonBlank(input.objectType, "object type");
  const modifiedProperty = assertNonBlank(
    input.modifiedProperty ?? "hs_lastmodifieddate",
    "modified property",
  );
  const limit = assertLimit(input.limit, 200, 200);
  const properties = input.properties?.map((property) => assertNonBlank(property, "property"));

  const payload = await hubspotRequest({
    ...input,
    method: "POST",
    path: `/crm/objects/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}/search`,
    body: {
      filterGroups: [
        {
          filters: [
            {
              propertyName: modifiedProperty,
              operator: "GTE",
              value: toTimestamp(input.updatedAfter),
            },
          ],
        },
      ],
      sorts: [modifiedProperty],
      limit,
      ...(input.after?.trim() ? { after: input.after.trim() } : {}),
      ...(properties && properties.length > 0 ? { properties } : {}),
    },
    responseSchema: hubspotObjectPageResponseSchema,
  });
  return normalizePage(payload);
}

export async function fetchHubspotRecord(
  input: FetchHubspotRecordInput,
): Promise<HubspotObjectRecord> {
  const objectType = assertNonBlank(input.objectType, "object type");
  const recordId = assertNonBlank(input.recordId, "record ID");
  const url = new URL(
    `/crm/objects/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}/${encodeURIComponent(recordId)}`,
    "https://hubspot.invalid",
  );
  if (input.idProperty?.trim()) {
    url.searchParams.set("idProperty", input.idProperty.trim());
  }
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  appendList(url, "properties", input.properties);
  appendList(url, "associations", input.associations);

  return hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotObjectRecordSchema,
  });
}

export async function batchReadHubspotObjects(
  input: BatchReadHubspotObjectsInput,
): Promise<HubspotObjectRecord[]> {
  const objectType = assertNonBlank(input.objectType, "object type");
  if (input.recordIds.length < 1 || input.recordIds.length > 100) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "HubSpot object batch reads require between 1 and 100 record IDs",
      { retryable: false },
    );
  }

  const recordIds = input.recordIds.map((recordId) =>
    assertNonBlank(recordId, "record ID"));
  const properties = input.properties?.map((property) =>
    assertNonBlank(property, "property")) ?? [];
  const payload = await hubspotRequest({
    ...input,
    method: "POST",
    path: `/crm/objects/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}/batch/read`,
    body: {
      inputs: recordIds.map((id) => ({ id })),
      ...(properties.length > 0 ? { properties } : {}),
      ...(input.archived === true ? { archived: true } : {}),
    },
    responseSchema: hubspotObjectPageResponseSchema,
  });

  return payload.results;
}

type HubspotBatchWriteRecord = Readonly<{
  id: string;
  idProperty?: string;
  properties: Readonly<Record<string, string | null | undefined>>;
  objectWriteTraceId?: string;
}>;

type ValidatedHubspotBatchWriteRecord = Readonly<{
  id: string;
  idProperty?: string;
  properties: Record<string, string | null>;
  objectWriteTraceId: string;
}>;

function defaultTraceId(
  objectType: string,
  operation: "upsert" | "update",
  record: HubspotBatchWriteRecord,
): string {
  const digest = createHash("sha256")
    .update(objectType)
    .update("\0")
    .update(operation)
    .update("\0")
    .update(record.idProperty ?? "record_id")
    .update("\0")
    .update(record.id)
    .digest("hex")
    .slice(0, 32);
  return `sp-${digest}`;
}

function extractTraceId(error: z.infer<typeof batchErrorSchema>): string | null {
  if (error.objectWriteTraceId) {
    return error.objectWriteTraceId;
  }
  for (const nested of error.errors ?? []) {
    if (nested.objectWriteTraceId) {
      return nested.objectWriteTraceId;
    }
    const nestedContextTrace = traceValueFromContext(nested.context);
    if (typeof nestedContextTrace === "string") {
      return nestedContextTrace;
    }
  }
  const contextTrace = traceValueFromContext(error.context);
  if (typeof contextTrace === "string") {
    return contextTrace;
  }
  return null;
}

function traceValueFromContext(context: unknown): string | null {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    return null;
  }
  const trace = (context as Record<string, unknown>).objectWriteTraceId;
  if (typeof trace === "string") {
    return trace;
  }
  if (Array.isArray(trace) && typeof trace[0] === "string") {
    return trace[0];
  }
  return null;
}

function safeErrorMessage(error: z.infer<typeof batchErrorSchema>): string {
  const message = error.message ?? error.errors?.find((item) => item.message)?.message;
  return (message?.trim() || "HubSpot rejected this object").slice(0, 500);
}

function safeErrorCode(error: z.infer<typeof batchErrorSchema>): string | null {
  return (
    error.errors?.find((item) => item.code)?.code ??
    (typeof error.subCategory === "string" ? error.subCategory : null)
  );
}

function validateRecords(
  objectType: string,
  operation: "upsert" | "update",
  records: readonly HubspotBatchWriteRecord[],
): ValidatedHubspotBatchWriteRecord[] {
  if (records.length === 0) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      `HubSpot batch ${operation} requires records`,
      { retryable: false },
    );
  }

  const traces = new Set<string>();
  return records.map((record) => {
    const id = assertNonBlank(record.id, "record unique ID");
    const idProperty = operation === "upsert"
      ? assertNonBlank(record.idProperty ?? "", "record ID property")
      : undefined;
    const objectWriteTraceId = assertNonBlank(
      record.objectWriteTraceId ?? defaultTraceId(objectType, operation, record),
      "write trace ID",
    );
    if (traces.has(objectWriteTraceId)) {
      throw new HubspotError(
        "HUBSPOT_INVALID_INPUT",
        400,
        "HubSpot write trace IDs must be unique",
        { retryable: false },
      );
    }
    traces.add(objectWriteTraceId);

    const properties = Object.fromEntries(
      Object.entries(record.properties).flatMap(([name, value]) => {
        const normalizedName = assertNonBlank(name, "property name");
        // HubSpot uses explicit empty values to clear properties. Only an
        // omitted (`undefined`) value means "do not write this property".
        if (value === undefined) {
          return [];
        }
        return [[normalizedName, value]];
      }),
    );
    return {
      id,
      ...(idProperty ? { idProperty } : {}),
      properties,
      objectWriteTraceId,
    };
  });
}

async function batchWriteHubspotObjects(
  input: HubspotClientOptions & Readonly<{
    objectType: string;
    records: readonly HubspotBatchWriteRecord[];
    onChunkComplete?: (checkpoint: HubspotBatchUpsertChunkCheckpoint) => void | Promise<void>;
  }>,
  operation: "upsert" | "update",
): Promise<BatchUpsertHubspotObjectsResult> {
  const objectType = assertNonBlank(input.objectType, "object type");
  const records = validateRecords(objectType, operation, input.records);
  const outcomes = new Map<string, HubspotBatchUpsertOutcome>();

  for (let chunkStart = 0; chunkStart < records.length; chunkStart += 100) {
    const chunk = records.slice(chunkStart, chunkStart + 100);
    const response = await hubspotRequest({
      ...input,
      method: "POST",
      path: `/crm/objects/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}/batch/${operation}`,
      body: {
        inputs: chunk.map((record) => ({
          id: record.id,
          ...(record.idProperty ? { idProperty: record.idProperty } : {}),
          properties: record.properties,
          objectWriteTraceId: record.objectWriteTraceId,
        })),
      },
      responseSchema: batchUpsertResponseSchema,
      acceptedStatuses: [200, 207],
    });

    for (const result of response.results) {
      const inputIndex = records.findIndex(
        (record) => record.objectWriteTraceId === result.objectWriteTraceId,
      );
      if (inputIndex < 0 || outcomes.has(result.objectWriteTraceId)) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot returned an unknown or duplicate write trace ID",
          { retryable: false },
        );
      }
      outcomes.set(result.objectWriteTraceId, {
        inputIndex,
        objectWriteTraceId: result.objectWriteTraceId,
        success: true,
        id: result.id,
        created: result.new ?? null,
        properties: result.properties,
        ...(result.createdAt ? { createdAt: result.createdAt } : {}),
        ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}),
        ...(result.url ? { url: result.url } : {}),
      });
    }

    for (const error of response.errors) {
      const traceId = extractTraceId(error)
        ?? (error.id
          ? records.find((record) => record.id === error.id)?.objectWriteTraceId ?? null
          : null);
      if (!traceId) {
        continue;
      }
      const inputIndex = records.findIndex((record) => record.objectWriteTraceId === traceId);
      if (inputIndex < 0 || outcomes.has(traceId)) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot returned an unknown or duplicate write trace ID",
          { retryable: false },
        );
      }
      outcomes.set(traceId, {
        inputIndex,
        objectWriteTraceId: traceId,
        success: false,
        category: error.category ?? null,
        code: safeErrorCode(error),
        message: safeErrorMessage(error),
      });
    }

    const unresolved = chunk.filter((record) => !outcomes.has(record.objectWriteTraceId));
    if (unresolved.length > 0) {
      const unscopedError = response.errors.find((error) => {
        if (extractTraceId(error)) {
          return false;
        }
        return !error.id || !records.some((record) => record.id === error.id);
      });
      if (!unscopedError || unresolved.length !== 1) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot batch response did not identify every submitted record",
          { retryable: false },
        );
      }
      const record = unresolved[0];
      if (!record) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot batch response could not be mapped",
          { retryable: false },
        );
      }
      const inputIndex = records.findIndex(
        (candidate) => candidate.objectWriteTraceId === record.objectWriteTraceId,
      );
      outcomes.set(record.objectWriteTraceId, {
        inputIndex,
        objectWriteTraceId: record.objectWriteTraceId,
        success: false,
        category: unscopedError.category ?? null,
        code: safeErrorCode(unscopedError),
        message: safeErrorMessage(unscopedError),
      });
    }

    const chunkOutcomes = chunk.map((record) => {
      const outcome = outcomes.get(record.objectWriteTraceId);
      if (!outcome) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot batch response was incomplete",
          { retryable: false },
        );
      }
      return outcome;
    });
    await input.onChunkComplete?.({
      chunkIndex: chunkStart / 100,
      inputStartIndex: chunkStart,
      inputEndIndexExclusive: chunkStart + chunk.length,
      outcomes: chunkOutcomes,
      succeeded: chunkOutcomes.filter((outcome) => outcome.success).length,
      failed: chunkOutcomes.filter((outcome) => !outcome.success).length,
    });
  }

  const ordered = records.map((record) => {
    const outcome = outcomes.get(record.objectWriteTraceId);
    if (!outcome) {
      throw new HubspotError(
        "HUBSPOT_INVALID_RESPONSE",
        502,
        "HubSpot batch response was incomplete",
        { retryable: false },
      );
    }
    return outcome;
  });
  return {
    outcomes: ordered,
    succeeded: ordered.filter((outcome) => outcome.success).length,
    failed: ordered.filter((outcome) => !outcome.success).length,
  };
}

export function batchUpsertHubspotObjects(
  input: BatchUpsertHubspotObjectsInput,
): Promise<BatchUpsertHubspotObjectsResult> {
  return batchWriteHubspotObjects(input, "upsert");
}

export function batchUpdateHubspotObjects(
  input: BatchUpdateHubspotObjectsInput,
): Promise<BatchUpsertHubspotObjectsResult> {
  return batchWriteHubspotObjects(input, "update");
}

export function batchUpsertHubspotContacts(
  input: BatchUpsertHubspotContactsInput,
): Promise<BatchUpsertHubspotObjectsResult> {
  if (
    input.allowEmailIdentifierForFullUpsert !== true &&
    input.records.some((record) => record.idProperty.trim().toLowerCase() === "email")
  ) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "Partial contact upserts require a custom unique ID property; email is allowed only for an explicitly complete upsert",
      { retryable: false },
    );
  }
  return batchUpsertHubspotObjects({ ...input, objectType: "contacts" });
}

export function batchUpsertHubspotDeals(
  input: BatchUpsertHubspotDealsInput,
): Promise<BatchUpsertHubspotObjectsResult> {
  if (
    input.records.some((record) =>
      ["hs_object_id", "email", "domain"].includes(record.idProperty.trim().toLowerCase()),
    )
  ) {
    throw new HubspotError(
      "HUBSPOT_INVALID_INPUT",
      400,
      "Deal upserts require a custom unique ID property",
      { retryable: false },
    );
  }
  return batchUpsertHubspotObjects({ ...input, objectType: "deals" });
}

/**
 * Updates existing contacts by HubSpot Record ID.
 *
 * HubSpot's contact guide reserves batch upsert for email or custom unique
 * properties. Record-ID writes therefore use batch/update and deliberately
 * omit idProperty.
 */
export function batchUpdateHubspotContacts(
  input: BatchUpdateHubspotContactsInput,
): Promise<BatchUpsertHubspotObjectsResult> {
  return batchUpdateHubspotObjects({ ...input, objectType: "contacts" });
}
