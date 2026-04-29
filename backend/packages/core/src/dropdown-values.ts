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
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  fetchHubspotAccountDetails,
  fetchHubspotPropertyDefinition,
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

const HUBSPOT_DROPDOWN_SOURCE_BY_FIELD = {
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
    objectType: "2-200856187",
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
} as const satisfies Record<
  HubspotSyncedDropdownFieldKey,
  | { kind: "accountCurrencies" }
  | { kind: "property"; objectType: string; propertyName: string }
>;

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
  createdAt: Date;
  updatedAt: Date;
}): DropdownValue {
  return {
    id: record.id,
    fieldKey: fromPrismaFieldKey(record.fieldKey),
    value: record.value,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function normalizeDropdownValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function extractHubspotOptionLabels(
  definition: Awaited<ReturnType<typeof fetchHubspotPropertyDefinition>>,
): string[] {
  return normalizeDropdownValues(
    definition.options.map((option) => option.label?.trim() || option.value?.trim() || ""),
  );
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
}): Promise<ListDropdownValuesResponse> {
  const syncedValues = Object.fromEntries(
    await Promise.all(
      HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS.map(async (fieldKey) => {
        const source = HUBSPOT_DROPDOWN_SOURCE_BY_FIELD[fieldKey];

        if (source.kind === "accountCurrencies") {
          const details = await fetchHubspotAccountDetails({
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
          });

          return [fieldKey, normalizeDropdownValues([
            details.companyCurrency ?? "",
            ...details.additionalCurrencies,
          ])];
        }

        const definition = await fetchHubspotPropertyDefinition({
          objectType: source.objectType,
          propertyName: source.propertyName,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
        });

        return [fieldKey, extractHubspotOptionLabels(definition)];
      }),
    ),
  ) as Record<HubspotSyncedDropdownFieldKey, string[]>;

  await withDbTransaction(async (tx) => {
    for (const fieldKey of HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS) {
      await tx.dropdownValue.deleteMany({
        where: {
          fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[fieldKey],
        },
      });

      if (syncedValues[fieldKey].length > 0) {
        await tx.dropdownValue.createMany({
          data: syncedValues[fieldKey].map((value) => ({
            fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[fieldKey],
            value,
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
          })),
        },
      },
    });
  });

  return listDropdownValues();
}
