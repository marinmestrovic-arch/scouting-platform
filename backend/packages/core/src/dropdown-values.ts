import type { DropdownValueFieldKey as PrismaDropdownValueFieldKey } from "@prisma/client";
import type {
  DropdownValue,
  DropdownValueFieldKey,
  ListDropdownValuesResponse,
  UpdateDropdownValuesRequest,
} from "@scouting-platform/contracts";
import { COUNTRY_REGION_OPTIONS, updateDropdownValuesRequestSchema } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

const DEFAULT_DROPDOWN_VALUES: Record<DropdownValueFieldKey, readonly string[]> = {
  currency: ["EUR", "USD", "GBP"],
  dealType: ["Influencer", "Paid", "Affiliate"],
  activationType: ["Dedicated Video", "Integration", "Shorts", "Livestream"],
  influencerType: ["YouTube Creator", "Streamer", "Podcaster"],
  influencerVertical: ["Gaming", "Lifestyle", "Beauty", "Tech", "General"],
  countryRegion: COUNTRY_REGION_OPTIONS,
  language: ["English", "German", "French", "Spanish", "Italian", "Croatian"],
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

export async function ensureDropdownValueDefaults(): Promise<void> {
  const existingCount = await prisma.dropdownValue.count();

  if (existingCount > 0) {
    return;
  }

  await prisma.dropdownValue.createMany({
    data: (Object.entries(DEFAULT_DROPDOWN_VALUES) as Array<[DropdownValueFieldKey, readonly string[]]>)
      .flatMap(([fieldKey, values]) =>
        values.map((value) => ({
          fieldKey: PRISMA_DROPDOWN_FIELD_KEYS[fieldKey],
          value,
        })),
      ),
    skipDuplicates: true,
  });
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

function normalizeDropdownValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function replaceDropdownValues(input: UpdateDropdownValuesRequest & {
  actorUserId: string;
}): Promise<ListDropdownValuesResponse> {
  const payload = updateDropdownValuesRequestSchema.parse(input);
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
