import { DropdownValueFieldKey as PrismaDropdownValueFieldKey } from "@prisma/client";
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

const toPrismaFieldKey: Record<DropdownValueFieldKey, PrismaDropdownValueFieldKey> = {
  currency: PrismaDropdownValueFieldKey.CURRENCY,
  dealType: PrismaDropdownValueFieldKey.DEAL_TYPE,
  activationType: PrismaDropdownValueFieldKey.ACTIVATION_TYPE,
  influencerType: PrismaDropdownValueFieldKey.INFLUENCER_TYPE,
  influencerVertical: PrismaDropdownValueFieldKey.INFLUENCER_VERTICAL,
  countryRegion: PrismaDropdownValueFieldKey.COUNTRY_REGION,
  language: PrismaDropdownValueFieldKey.LANGUAGE,
};

const fromPrismaFieldKey: Record<PrismaDropdownValueFieldKey, DropdownValueFieldKey> = {
  [PrismaDropdownValueFieldKey.CURRENCY]: "currency",
  [PrismaDropdownValueFieldKey.DEAL_TYPE]: "dealType",
  [PrismaDropdownValueFieldKey.ACTIVATION_TYPE]: "activationType",
  [PrismaDropdownValueFieldKey.INFLUENCER_TYPE]: "influencerType",
  [PrismaDropdownValueFieldKey.INFLUENCER_VERTICAL]: "influencerVertical",
  [PrismaDropdownValueFieldKey.COUNTRY_REGION]: "countryRegion",
  [PrismaDropdownValueFieldKey.LANGUAGE]: "language",
};

function toDropdownValue(record: {
  id: string;
  fieldKey: PrismaDropdownValueFieldKey;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}): DropdownValue {
  const fieldKey = fromPrismaFieldKey[record.fieldKey];

  return {
    id: record.id,
    fieldKey,
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
          fieldKey: toPrismaFieldKey[fieldKey],
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
        fieldKey: toPrismaFieldKey[payload.fieldKey],
      },
    });

    if (values.length > 0) {
      await tx.dropdownValue.createMany({
        data: values.map((value) => ({
          fieldKey: toPrismaFieldKey[payload.fieldKey],
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
