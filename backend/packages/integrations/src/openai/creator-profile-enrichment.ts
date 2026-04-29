import process from "node:process";

import OpenAI from "openai";
import { z } from "zod";

const OPENAI_MODEL_FALLBACK = "gpt-5-nano";

const profileFieldSchema = z.enum([
  "First Name",
  "Last Name",
  "Email",
  "Influencer Type",
  "Influencer Vertical",
  "Country/Region",
  "Language",
]);

const dropdownProfileFields = [
  "Influencer Type",
  "Influencer Vertical",
  "Country/Region",
  "Language",
] as const satisfies readonly z.infer<typeof profileFieldSchema>[];

const requestSchema = z.object({
  rowKey: z.string().trim().min(1),
  channelName: z.string(),
  channelUrl: z.string(),
  campaignName: z.string(),
  requestedFields: z.array(profileFieldSchema).min(1),
  contextText: z.string(),
});

const inputSchema = z.object({
  requests: z.array(requestSchema).min(1),
  dropdownOptions: z.object({
    "Influencer Type": z.array(z.string()),
    "Influencer Vertical": z.array(z.string()),
    "Country/Region": z.array(z.string()),
    "Language": z.array(z.string()),
  }),
  apiKey: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  client: z.custom<OpenAiClientLike>().optional(),
});

const responseRowSchema = z.object({
  row_key: z.string(),
  "First Name": z.string().optional().default(""),
  "Last Name": z.string().optional().default(""),
  Email: z.string().optional().default(""),
  "Influencer Type": z.string().optional().default(""),
  "Influencer Vertical": z.union([z.array(z.string()), z.string()]).optional().default([]),
  "Country/Region": z.string().optional().default(""),
  Language: z.string().optional().default(""),
});

const responseSchema = z.object({
  rows: z.array(responseRowSchema),
});

type OpenAiCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  [key: string]: unknown;
};

type OpenAiResponsesResponse = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: unknown;
    }>;
  }>;
  [key: string]: unknown;
};

type OpenAiClientLike = {
  responses?: {
    create(input: Record<string, unknown>): Promise<OpenAiResponsesResponse>;
  };
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<OpenAiCompletionResponse>;
    };
  };
};

type ProfileField = z.infer<typeof profileFieldSchema>;
type ParsedResponseRow = z.infer<typeof responseRowSchema>;

export type CreatorProfileEnrichmentRequest = z.infer<typeof requestSchema>;
export type CreatorProfileEnrichmentInput = z.input<typeof inputSchema>;
export type CreatorProfileEnrichmentResult = {
  rowKey: string;
  values: Record<string, string>;
};

export class OpenAiCreatorProfileEnrichmentError extends Error {
  readonly code:
    | "OPENAI_API_KEY_MISSING"
    | "OPENAI_AUTH_FAILED"
    | "OPENAI_RATE_LIMITED"
    | "OPENAI_INVALID_RESPONSE"
    | "OPENAI_ENRICHMENT_FAILED";
  readonly status: number;

  constructor(
    code: OpenAiCreatorProfileEnrichmentError["code"],
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenAiCreatorProfileEnrichmentError";
    this.code = code;
    this.status = status;
  }
}

function getApiKey(override?: string): string {
  const apiKey = override?.trim() || process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAiCreatorProfileEnrichmentError(
      "OPENAI_API_KEY_MISSING",
      500,
      "OPENAI_API_KEY is required for Creator List profile enrichment",
    );
  }

  return apiKey;
}

function getClient(apiKey: string, override?: OpenAiClientLike): OpenAiClientLike {
  return override ?? (new OpenAI({ apiKey }) as unknown as OpenAiClientLike);
}

function getModel(override?: string): string {
  return override?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_MODEL_FALLBACK;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .join("")
    .trim();
}

function extractResponsesText(response: OpenAiResponsesResponse): string {
  if (typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function stripJsonFences(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function parseJsonContent(content: string): unknown {
  const stripped = stripJsonFences(content);

  try {
    return JSON.parse(stripped);
  } catch {
    const objectMatch = stripped.match(/\{[\s\S]*\}/u);

    if (!objectMatch) {
      return null;
    }

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function buildRowsPayload(requests: readonly CreatorProfileEnrichmentRequest[]) {
  return requests.map((request) => ({
    row_key: request.rowKey,
    requested_fields: request.requestedFields,
    channel_name: request.channelName,
    channel_url: request.channelUrl,
    campaign_name: request.campaignName,
    creator_context: request.contextText,
  }));
}

function buildPrimaryPrompt(input: z.output<typeof inputSchema>): string {
  return [
    "Process each creator independently and return JSON only.",
    "Return exactly one result object for each provided row_key.",
    "Fill only requested fields. Use an empty string or empty array when uncertain.",
    "Only include First Name and Last Name when the creator is clearly an individual person and the split is unambiguous.",
    "Only include Email when an explicit email address appears in the provided evidence.",
    "If multiple explicit emails appear, prefer channel bio evidence, then channel page/about evidence, then video descriptions.",
    "Return Email as a plain email address only.",
    "For Influencer Type, Country/Region, and Language, use exact values from the allowed lists.",
    "For Influencer Vertical, return 1 to 3 exact allowed values as an array.",
    "",
    "Rows to process:",
    JSON.stringify(buildRowsPayload(input.requests), null, 2),
    "",
    `Allowed Influencer Type values: ${JSON.stringify(input.dropdownOptions["Influencer Type"])}`,
    `Allowed Influencer Vertical values: ${JSON.stringify(input.dropdownOptions["Influencer Vertical"])}`,
    `Allowed Country/Region values: ${JSON.stringify(input.dropdownOptions["Country/Region"])}`,
    `Allowed Language values: ${JSON.stringify(input.dropdownOptions.Language)}`,
  ].join("\n");
}

function buildClassificationPrompt(input: z.output<typeof inputSchema>): string {
  return [
    "Classify only the requested dropdown fields from the creator evidence.",
    "Return JSON only and exactly one result object for each row_key.",
    "Use only exact allowed option labels. Use an empty string or empty array when no option is supported.",
    "Influencer Vertical may contain 1 to 3 exact allowed values as an array.",
    "",
    "Rows to classify:",
    JSON.stringify(buildRowsPayload(input.requests), null, 2),
    "",
    `Allowed Influencer Type values: ${JSON.stringify(input.dropdownOptions["Influencer Type"])}`,
    `Allowed Influencer Vertical values: ${JSON.stringify(input.dropdownOptions["Influencer Vertical"])}`,
    `Allowed Country/Region values: ${JSON.stringify(input.dropdownOptions["Country/Region"])}`,
    `Allowed Language values: ${JSON.stringify(input.dropdownOptions.Language)}`,
  ].join("\n");
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildScalarDropdownSchema(options: readonly string[]) {
  const values = uniqueValues(["", ...options]);

  if (values.length <= 1) {
    return { type: "string" };
  }

  return {
    type: "string",
    enum: values,
  };
}

function buildVerticalDropdownSchema(options: readonly string[]) {
  const values = uniqueValues(options);

  if (values.length === 0) {
    return {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    };
  }

  return {
    type: "array",
    items: {
      type: "string",
      enum: values,
    },
    maxItems: 3,
  };
}

function buildStrictJsonSchema(dropdownOptions: z.output<typeof inputSchema>["dropdownOptions"]) {
  const stringField = { type: "string" };

  return {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "row_key",
            "First Name",
            "Last Name",
            "Email",
            "Influencer Type",
            "Influencer Vertical",
            "Country/Region",
            "Language",
          ],
          properties: {
            row_key: stringField,
            "First Name": stringField,
            "Last Name": stringField,
            Email: stringField,
            "Influencer Type": buildScalarDropdownSchema(dropdownOptions["Influencer Type"]),
            "Influencer Vertical": buildVerticalDropdownSchema(dropdownOptions["Influencer Vertical"]),
            "Country/Region": buildScalarDropdownSchema(dropdownOptions["Country/Region"]),
            Language: buildScalarDropdownSchema(dropdownOptions.Language),
          },
        },
      },
    },
  };
}

function toProviderError(error: unknown): OpenAiCreatorProfileEnrichmentError {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;

  if (status === 401 || status === 403) {
    return new OpenAiCreatorProfileEnrichmentError(
      "OPENAI_AUTH_FAILED",
      401,
      "OpenAI API key is invalid or unauthorized",
    );
  }

  if (status === 429) {
    return new OpenAiCreatorProfileEnrichmentError(
      "OPENAI_RATE_LIMITED",
      429,
      "OpenAI rate limit exceeded",
    );
  }

  return new OpenAiCreatorProfileEnrichmentError(
    "OPENAI_ENRICHMENT_FAILED",
    502,
    "OpenAI Creator List profile enrichment request failed",
  );
}

async function createStrictJsonCompletion(input: {
  client: OpenAiClientLike;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  dropdownOptions: z.output<typeof inputSchema>["dropdownOptions"];
}): Promise<string> {
  const jsonSchema = buildStrictJsonSchema(input.dropdownOptions);
  let responsesError: unknown = null;

  if (input.client.responses?.create) {
    try {
      const response = await input.client.responses.create({
        model: input.model,
        input: [
          {
            role: "system",
            content: input.systemPrompt,
          },
          {
            role: "user",
            content: input.userPrompt,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "creator_profile_enrichment",
            strict: true,
            schema: jsonSchema,
          },
        },
      });
      const text = extractResponsesText(response);

      if (text) {
        return text;
      }
    } catch (error) {
      responsesError = error;
    }
  }

  try {
    const response = await input.client.chat.completions.create({
      model: input.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "creator_profile_enrichment",
          strict: true,
          schema: jsonSchema,
        },
      },
      messages: [
        {
          role: "system",
          content: input.systemPrompt,
        },
        {
          role: "user",
          content: input.userPrompt,
        },
      ],
    });
    const text = extractTextContent(response.choices?.[0]?.message?.content);

    if (text) {
      return text;
    }
  } catch (error) {
    throw toProviderError(error);
  }

  if (responsesError) {
    throw toProviderError(responsesError);
  }

  throw new OpenAiCreatorProfileEnrichmentError(
    "OPENAI_INVALID_RESPONSE",
    502,
    "OpenAI returned empty Creator List profile enrichment content",
  );
}

async function requestCreatorProfileRows(input: {
  client: OpenAiClientLike;
  model: string;
  requestInput: z.output<typeof inputSchema>;
  classificationOnly: boolean;
}): Promise<ParsedResponseRow[]> {
  const content = await createStrictJsonCompletion({
    client: input.client,
    model: input.model,
    systemPrompt: input.classificationOnly
      ? "You classify creator CRM dropdown fields using explicit creator evidence and exact allowed option labels."
      : "You enrich creator CRM rows using explicit creator evidence. Be conservative and respond with valid JSON only.",
    userPrompt: input.classificationOnly
      ? buildClassificationPrompt(input.requestInput)
      : buildPrimaryPrompt(input.requestInput),
    dropdownOptions: input.requestInput.dropdownOptions,
  });
  const parsed = responseSchema.safeParse(parseJsonContent(content));

  if (!parsed.success) {
    throw new OpenAiCreatorProfileEnrichmentError(
      "OPENAI_INVALID_RESPONSE",
      502,
      "OpenAI returned invalid Creator List profile enrichment output",
    );
  }

  return parsed.data.rows;
}

function rowToValues(row: ParsedResponseRow): Record<string, string> {
  return {
    "First Name": row["First Name"],
    "Last Name": row["Last Name"],
    Email: row.Email,
    "Influencer Type": row["Influencer Type"],
    "Influencer Vertical": Array.isArray(row["Influencer Vertical"])
      ? row["Influencer Vertical"].join("; ")
      : row["Influencer Vertical"],
    "Country/Region": row["Country/Region"],
    Language: row.Language,
  };
}

function getResultFieldValue(
  row: Record<string, string> | undefined,
  field: ProfileField,
): string {
  return row?.[field]?.trim() ?? "";
}

export async function enrichCreatorProfilesWithOpenAi(
  rawInput: CreatorProfileEnrichmentInput,
): Promise<CreatorProfileEnrichmentResult[]> {
  const input = inputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const client = getClient(apiKey, input.client);
  const model = getModel(input.model);
  const primaryRows = await requestCreatorProfileRows({
    client,
    model,
    requestInput: input,
    classificationOnly: false,
  });
  const valuesByRowKey = new Map(primaryRows.map((row) => [row.row_key, rowToValues(row)]));
  const classificationRequests: CreatorProfileEnrichmentRequest[] = [];

  for (const request of input.requests) {
    const existing = valuesByRowKey.get(request.rowKey);
    const missingDropdownFields = request.requestedFields.filter(
      (field): field is (typeof dropdownProfileFields)[number] =>
        dropdownProfileFields.includes(field as (typeof dropdownProfileFields)[number])
        && !getResultFieldValue(existing, field),
    );

    if (missingDropdownFields.length === 0) {
      continue;
    }

    classificationRequests.push({
      ...request,
      requestedFields: missingDropdownFields,
    });
  }

  if (classificationRequests.length > 0) {
    const classificationRows = await requestCreatorProfileRows({
      client,
      model,
      requestInput: {
        ...input,
        requests: classificationRequests,
      },
      classificationOnly: true,
    });

    for (const row of classificationRows) {
      const current = valuesByRowKey.get(row.row_key) ?? {};
      const next = rowToValues(row);

      for (const field of dropdownProfileFields) {
        if (!current[field]?.trim() && next[field]?.trim()) {
          current[field] = next[field];
        }
      }

      valuesByRowKey.set(row.row_key, current);
    }
  }

  return input.requests.map((request) => ({
    rowKey: request.rowKey,
    values: valuesByRowKey.get(request.rowKey) ?? {},
  }));
}
