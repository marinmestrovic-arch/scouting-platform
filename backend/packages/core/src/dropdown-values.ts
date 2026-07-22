import type { DropdownValueFieldKey as PrismaDropdownValueFieldKey } from "@prisma/client";
import type {
  DropdownValue,
  DropdownValueFieldKey,
  HubspotSyncedDropdownFieldKey,
  ListDropdownValuesResponse,
  UpdateDropdownValuesRequest,
} from "@scouting-platform/contracts";
import {
  HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS,
  updateDropdownValuesRequestSchema,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction, type DbTransactionClient } from "@scouting-platform/db";
import {
  fetchHubspotAccountDetails,
  fetchHubspotPropertyDefinition,
  loadHubspotConfig,
} from "@scouting-platform/integrations";

import { ServiceError } from "./errors";

const DEFAULT_DROPDOWN_VALUES: Record<DropdownValueFieldKey, readonly string[]> = {
  currency: [],
  dealType: [],
  activationType: [],
  influencerType: [],
  influencerVertical: [],
  countryRegion: [],
  language: [],
};

// Keep these as local string literals so importing the core barrel into action-browser
// stubs does not depend on the runtime enum object from @prisma/client.
const PRISMA_DROPDOWN_FIELD_KEYS = {
  currency: "CURRENCY",
  dealType: "DEAL_TYPE",
  activationType: "ACTIVATION_TYPE",
  influencerType: "INFLUENCER_TYPE",
  influencerVertical: "INFLUENCER_VERTICAL",
  countryRegion: "COUNTRY_REGION",
  language: "LANGUAGE",
} as const satisfies Record<DropdownValueFieldKey, PrismaDropdownValueFieldKey>;

type HubspotDropdownSource =
  | { kind: "accountCurrencies" }
  | { kind: "property"; objectType: string; propertyName: string };

export type HubspotDropdownMutationTransaction = (
  mutation: (tx: DbTransactionClient) => Promise<void>,
) => Promise<void>;

export function getHubspotDropdownSources(input?: {
  activationObjectType?: string | null;
}): Record<
  HubspotSyncedDropdownFieldKey,
  HubspotDropdownSource
> {
  const activationObjectType =
    input?.activationObjectType?.trim() ??
    loadHubspotConfig().objectMappings.activationObjectType;

  if (!activationObjectType) {
    throw new ServiceError(
      "HUBSPOT_DROPDOWN_CONFIG_MISSING",
      500,
      "HUBSPOT_ACTIVATION_OBJECT_TYPE is required to synchronize activation types",
    );
  }

  return {
    currency: {
      kind: "accountCurrencies",
    },
    dealType: {
      kind: "property",
      objectType: "deals",
      propertyName: "dealtype",
    },
    activationType: {
      kind: "property",
      objectType: activationObjectType,
      propertyName: "activation_type",
    },
    influencerType: {
      kind: "property",
      objectType: "contacts",
      propertyName: "influencer_type",
    },
    influencerVertical: {
      kind: "property",
      objectType: "contacts",
      propertyName: "influencer_vertical",
    },
    countryRegion: {
      kind: "property",
      objectType: "contacts",
      propertyName: "country",
    },
    language: {
      kind: "property",
      objectType: "contacts",
      propertyName: "language",
    },
  };
}

const HUBSPOT_SYNCED_DROPDOWN_FIELD_SET = new Set<DropdownValueFieldKey>(
  HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS,
);

function fromPrismaFieldKey(fieldKey: PrismaDropdownValueFieldKey): DropdownValueFieldKey {
  switch (fieldKey) {
    case PRISMA_DROPDOWN_FIELD_KEYS.currency:
      return "currency";
    case PRISMA_DROPDOWN_FIELD_KEYS.dealType:
      return "dealType";
    case PRISMA_DROPDOWN_FIELD_KEYS.activationType:
      return "activationType";
    case PRISMA_DROPDOWN_FIELD_KEYS.influencerType:
      return "influencerType";
    case PRISMA_DROPDOWN_FIELD_KEYS.influencerVertical:
      return "influencerVertical";
    case PRISMA_DROPDOWN_FIELD_KEYS.countryRegion:
      return "countryRegion";
    case PRISMA_DROPDOWN_FIELD_KEYS.language:
      return "language";
  }
}

function toDropdownValue(record: {
  id: string;
  fieldKey: PrismaDropdownValueFieldKey;
  value: string;
  label?: string | null;
  internalValue?: string | null;
  source?: string | null;
  sourceObjectType?: string | null;
  sourcePropertyName?: string | null;
  hubspotPortalId?: string | null;
  hubspotSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DropdownValue {
  return {
    id: record.id,
    fieldKey: fromPrismaFieldKey(record.fieldKey),
    value: record.value,
    ...(typeof record.label === "string" ? { label: record.label } : {}),
    ...(typeof record.internalValue === "string"
      ? { internalValue: record.internalValue }
      : {}),
    ...(record.sourceObjectType === undefined
      ? {}
      : { sourceObjectType: record.sourceObjectType }),
    ...(record.sourcePropertyName === undefined
      ? {}
      : { sourcePropertyName: record.sourcePropertyName }),
    ...(record.hubspotPortalId === undefined
      ? {}
      : { hubspotPortalId: record.hubspotPortalId }),
    ...(record.hubspotSyncedAt === undefined
      ? {}
      : { hubspotSyncedAt: record.hubspotSyncedAt?.toISOString() ?? null }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function normalizeDropdownValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function extractHubspotDropdownOptions(
  definition: Awaited<ReturnType<typeof fetchHubspotPropertyDefinition>>,
): Array<{ label: string; internalValue: string }> {
  const options = new Map<string, { label: string; internalValue: string }>();

  for (const option of definition.options) {
    const label = option.label?.trim() || option.value?.trim();
    const internalValue = option.value?.trim();

    if (!label || !internalValue || options.has(internalValue)) {
      continue;
    }

    options.set(internalValue, { label, internalValue });
  }

  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export async function ensureDropdownValueDefaults(): Promise<void> {
  void DEFAULT_DROPDOWN_VALUES;
}

export async function listDropdownValues(): Promise<ListDropdownValuesResponse> {
  await ensureDropdownValueDefaults();

  const items = await prisma.dropdownValue.findMany({
    orderBy: [{ fieldKey: "asc" }, { value: "asc" }],
  });

  return {
    items: items.map(toDropdownValue),
  };
}

export async function listDropdownOptions(): Promise<Record<DropdownValueFieldKey, string[]>> {
  const response = await listDropdownValues();
  const options: Record<DropdownValueFieldKey, string[]> = {
    currency: [],
    dealType: [],
    activationType: [],
    influencerType: [],
    influencerVertical: [],
    countryRegion: [],
    language: [],
  };

  for (const item of response.items) {
    options[item.fieldKey].push(item.value);
  }

  return options;
}

export async function replaceDropdownValues(input: UpdateDropdownValuesRequest & {
  actorUserId: string;
}): Promise<ListDropdownValuesResponse> {
  const payload = updateDropdownValuesRequestSchema.parse(input);

  if (HUBSPOT_SYNCED_DROPDOWN_FIELD_SET.has(payload.fieldKey)) {
    throw new ServiceError(
      "DROPDOWN_VALUE_FIELD_HUBSPOT_SYNCED",
      400,
      `${payload.fieldKey} is synced from HubSpot and cannot be edited here`,
    );
  }

  const values = normalizeDropdownValues(payload.values);

  await withDbTransaction(async (tx) => {
    await tx.dropdownValue.deleteMany({
      where: {
        fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[payload.fieldKey],
      },
    });

    if (values.length > 0) {
      await tx.dropdownValue.createMany({
        data: values.map((value) => ({
          fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[payload.fieldKey],
          value,
        })),
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "dropdown_value.replaced",
        entityType: "dropdown_value_field",
        entityId: payload.fieldKey,
        metadata: {
          fieldKey: payload.fieldKey,
          values,
        },
      },
    });
  });

  return listDropdownValues();
}

export async function syncHubspotDropdownValues(input: {
  actorUserId: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  hubspotPortalId?: string | null;
  activationObjectType?: string | null;
  now?: Date;
  withMutationTransaction?: HubspotDropdownMutationTransaction;
}): Promise<ListDropdownValuesResponse> {
  const sources = getHubspotDropdownSources(
    input.activationObjectType === undefined
      ? undefined
      : { activationObjectType: input.activationObjectType },
  );
  const now = input.now ?? new Date();
  const syncedValues = Object.fromEntries(
    await Promise.all(
      HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS.map(async (fieldKey) => {
        const source = sources[fieldKey];

        if (source.kind === "accountCurrencies") {
          const details = await fetchHubspotAccountDetails({
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
          });

          return [
            fieldKey,
            normalizeDropdownValues([
              details.companyCurrency ?? "",
              ...details.additionalCurrencies,
            ]).map((value) => ({ label: value, internalValue: value })),
          ];
        }

        const definition = await fetchHubspotPropertyDefinition({
          objectType: source.objectType,
          propertyName: source.propertyName,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
        });

        return [fieldKey, extractHubspotDropdownOptions(definition)];
      }),
    ),
  ) as Record<
    HubspotSyncedDropdownFieldKey,
    Array<{ label: string; internalValue: string }>
  >;

  const withMutationTransaction = input.withMutationTransaction ?? withDbTransaction;

  await withMutationTransaction(async (tx) => {
    for (const fieldKey of HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS) {
      await tx.dropdownValue.deleteMany({
        where: {
          fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[fieldKey],
        },
      });

      if (syncedValues[fieldKey].length > 0) {
        const source = sources[fieldKey];
        await tx.dropdownValue.createMany({
          data: syncedValues[fieldKey].map((option) => ({
            fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[fieldKey],
            value: option.label,
            label: option.label,
            internalValue: option.internalValue,
            source: "hubspot",
            sourceObjectType: source.kind === "property" ? source.objectType : "account",
            sourcePropertyName:
              source.kind === "property" ? source.propertyName : "currencies",
            hubspotPortalId: input.hubspotPortalId ?? null,
            hubspotSyncedAt: now,
          })),
        });
      }
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "dropdown_value.synced_from_hubspot",
        entityType: "dropdown_value_sync",
        entityId: "hubspot",
        metadata: {
          syncedFields: HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS.map((fieldKey) => ({
            fieldKey,
            valueCount: syncedValues[fieldKey].length,
            sourceObjectType:
              sources[fieldKey].kind === "property"
                ? sources[fieldKey].objectType
                : "account",
          })),
        },
      },
    });
  });

  return listDropdownValues();
}
