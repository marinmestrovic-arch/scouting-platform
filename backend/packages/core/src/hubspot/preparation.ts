import type {
  HubspotPrepClearField,
  ExportPreviewDropdownOptions,
  ExportPreviewRow,
  HubspotPrepUpdateDefaults,
  HubspotPrepUpdateRequest,
} from "@scouting-platform/contracts";
import { hubspotPrepUpdateRequestSchema } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { listDropdownOptions } from "../dropdown-values";
import { ServiceError } from "../errors";

export const HUBSPOT_DEFAULT_FIELD_KEYS = [
  "currency",
  "dealType",
  "activationType",
  "influencerType",
  "influencerVertical",
  "countryRegion",
  "language",
] as const;

export const HUBSPOT_ROW_OVERRIDE_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  ...HUBSPOT_DEFAULT_FIELD_KEYS,
] as const;

export type HubspotDefaultFieldKey = (typeof HUBSPOT_DEFAULT_FIELD_KEYS)[number];
export type HubspotRowOverrideFieldKey = (typeof HUBSPOT_ROW_OVERRIDE_FIELD_KEYS)[number];

export type HubspotPreparationRun = {
  id: string;
  requestedByUserId: string;
  name: string;
  campaignName: string | null;
  client: string | null;
  market: string | null;
  briefLink: string | null;
  month: string | null;
  year: number | null;
  dealOwner: string | null;
  dealName: string | null;
  pipeline: string | null;
  dealStage: string | null;
  currency: string | null;
  dealType: string | null;
  activationType: string | null;
  hubspotInfluencerType: string | null;
  hubspotInfluencerVertical: string | null;
  hubspotCountryRegion: string | null;
  hubspotLanguage: string | null;
  rowOverrides: Array<{
    rowKey: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    currency: string | null;
    dealType: string | null;
    activationType: string | null;
    influencerType: string | null;
    influencerVertical: string | null;
    countryRegion: string | null;
    language: string | null;
  }>;
};

type RunAccessInput = {
  runId: string;
  userId: string;
  role: "admin" | "user";
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function buildHubspotRowKey(input: {
  resultId: string;
  contactEmail: string;
  contactIndex: number;
}): string {
  return `${input.resultId}:${input.contactEmail || input.contactIndex}`;
}

export function normalizeHubspotPrepDefaults(run: Pick<
  HubspotPreparationRun,
  | "currency"
  | "dealType"
  | "activationType"
  | "hubspotInfluencerType"
  | "hubspotInfluencerVertical"
  | "hubspotCountryRegion"
  | "hubspotLanguage"
>): HubspotPrepUpdateDefaults {
  return {
    currency: normalizeText(run.currency),
    dealType: normalizeText(run.dealType),
    activationType: normalizeText(run.activationType),
    influencerType: normalizeText(run.hubspotInfluencerType),
    influencerVertical: normalizeText(run.hubspotInfluencerVertical),
    countryRegion: normalizeText(run.hubspotCountryRegion),
    language: normalizeText(run.hubspotLanguage),
  };
}

function getRowOverrideMap(run: Pick<HubspotPreparationRun, "rowOverrides">) {
  return new Map(run.rowOverrides.map((row) => [row.rowKey, row]));
}

export function resolveHubspotRowValues(input: {
  defaults: HubspotPrepUpdateDefaults;
  fallbackValues: Record<string, string>;
  rowOverride: HubspotPreparationRun["rowOverrides"][number] | null;
}): Record<string, string> {
  const values = { ...input.fallbackValues };
  const override = input.rowOverride;

  for (const field of HUBSPOT_DEFAULT_FIELD_KEYS) {
    const overrideValue = override?.[field];
    if (typeof overrideValue === "string") {
      values[field] = overrideValue;
      continue;
    }

    const defaultValue = input.defaults[field];
    if (defaultValue.trim()) {
      values[field] = defaultValue;
      continue;
    }

    values[field] = input.fallbackValues[field] ?? "";
  }

  for (const field of ["firstName", "lastName", "email"] as const) {
    const overrideValue = override?.[field];
    if (typeof overrideValue === "string" && overrideValue.trim()) {
      values[field] = overrideValue;
    } else {
      values[field] = input.fallbackValues[field] ?? "";
    }
  }

  values.contactType = "Influencer";

  return values;
}

export function buildHubspotDropdownOptions(
  options: ExportPreviewDropdownOptions,
): ExportPreviewDropdownOptions {
  return options;
}

export async function getRunForHubspotPreparation(
  input: RunAccessInput,
): Promise<HubspotPreparationRun> {
  const run = await prisma.runRequest.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      requestedByUserId: true,
      name: true,
      campaignName: true,
      client: true,
      market: true,
      briefLink: true,
      month: true,
      year: true,
      dealOwner: true,
      dealName: true,
      pipeline: true,
      dealStage: true,
      currency: true,
      dealType: true,
      activationType: true,
      hubspotInfluencerType: true,
      hubspotInfluencerVertical: true,
      hubspotCountryRegion: true,
      hubspotLanguage: true,
      hubspotRowOverrides: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          rowKey: true,
          firstName: true,
          lastName: true,
          email: true,
          currency: true,
          dealType: true,
          activationType: true,
          influencerType: true,
          influencerVertical: true,
          countryRegion: true,
          language: true,
        },
      },
    },
  });

  if (!run) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && run.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  return {
    ...run,
    month: run.month?.toLowerCase() ?? null,
    rowOverrides: run.hubspotRowOverrides,
  };
}

async function validateDropdownValue(
  field: HubspotDefaultFieldKey,
  value: string,
  options: ExportPreviewDropdownOptions,
): Promise<void> {
  if (!value.trim()) {
    return;
  }

  if (!options[field].includes(value)) {
    throw new ServiceError("HUBSPOT_PREP_INVALID_DROPDOWN", 400, `${field} must use an existing dropdown value`);
  }
}

function hasAnyRowOverrideValue(values: Record<string, string | null | undefined>): boolean {
  return Object.values(values).some((value) => typeof value === "string" && value.trim().length > 0);
}

export async function updateHubspotPreparation(input: RunAccessInput & {
  actorUserId: string;
  payload: HubspotPrepUpdateRequest;
}): Promise<void> {
  const payload = hubspotPrepUpdateRequestSchema.parse(input.payload);
  const dropdownOptions = await listDropdownOptions();

  await withDbTransaction(async (tx) => {
    const run = await tx.runRequest.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        requestedByUserId: true,
        hubspotRowOverrides: {
          select: {
            id: true,
            rowKey: true,
            firstName: true,
            lastName: true,
            email: true,
            currency: true,
            dealType: true,
            activationType: true,
            influencerType: true,
            influencerVertical: true,
            countryRegion: true,
            language: true,
          },
        },
      },
    });

    if (!run) {
      throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
    }

    if (input.role !== "admin" && run.requestedByUserId !== input.userId) {
      throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
    }

    for (const field of HUBSPOT_DEFAULT_FIELD_KEYS) {
      await validateDropdownValue(field, payload.defaults[field], dropdownOptions);
    }

    await tx.runRequest.update({
      where: { id: run.id },
      data: {
        currency: payload.defaults.currency.trim() || null,
        dealType: payload.defaults.dealType.trim() || null,
        activationType: payload.defaults.activationType.trim() || null,
        hubspotInfluencerType: payload.defaults.influencerType.trim() || null,
        hubspotInfluencerVertical: payload.defaults.influencerVertical.trim() || null,
        hubspotCountryRegion: payload.defaults.countryRegion.trim() || null,
        hubspotLanguage: payload.defaults.language.trim() || null,
      },
    });

    const overridesByRowKey = new Map(run.hubspotRowOverrides.map((row) => [row.rowKey, row]));
    const clearedByRowKey = new Map<string, HubspotPrepClearField["field"][]>();

    for (const clearedField of payload.clearedFields) {
      const current = clearedByRowKey.get(clearedField.rowKey) ?? [];
      current.push(clearedField.field);
      clearedByRowKey.set(clearedField.rowKey, current);
    }

    const touchedRowKeys = new Set([
      ...payload.rowOverrides.map((item) => item.rowKey),
      ...payload.clearedFields.map((item) => item.rowKey),
    ]);

    for (const rowKey of touchedRowKeys) {
      const current = overridesByRowKey.get(rowKey);
      const patchValues = payload.rowOverrides.find((item) => item.rowKey === rowKey)?.values ?? {};
      const clearedFields = clearedByRowKey.get(rowKey) ?? [];
      const nextValues = {
        firstName: patchValues.firstName?.trim() ?? current?.firstName ?? null,
        lastName: patchValues.lastName?.trim() ?? current?.lastName ?? null,
        email: patchValues.email?.trim() ?? current?.email ?? null,
        currency: patchValues.currency?.trim() ?? current?.currency ?? null,
        dealType: patchValues.dealType?.trim() ?? current?.dealType ?? null,
        activationType: patchValues.activationType?.trim() ?? current?.activationType ?? null,
        influencerType: patchValues.influencerType?.trim() ?? current?.influencerType ?? null,
        influencerVertical: patchValues.influencerVertical?.trim() ?? current?.influencerVertical ?? null,
        countryRegion: patchValues.countryRegion?.trim() ?? current?.countryRegion ?? null,
        language: patchValues.language?.trim() ?? current?.language ?? null,
      };

      for (const field of clearedFields) {
        nextValues[field] = null;
      }

      for (const field of HUBSPOT_DEFAULT_FIELD_KEYS) {
        const candidate = nextValues[field];
        if (candidate) {
          await validateDropdownValue(field, candidate, dropdownOptions);
        }
      }

      if (!hasAnyRowOverrideValue(nextValues)) {
        if (current) {
          await tx.runHubspotRowOverride.delete({ where: { id: current.id } });
        }
        continue;
      }

      if (current) {
        await tx.runHubspotRowOverride.update({
          where: { id: current.id },
          data: nextValues,
        });
      } else {
        await tx.runHubspotRowOverride.create({
          data: {
            runRequestId: run.id,
            rowKey,
            ...nextValues,
          },
        });
      }
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "hubspot_prep.saved",
        entityType: "run_request",
        entityId: run.id,
        metadata: {
          defaults: payload.defaults,
          rowOverrideCount: payload.rowOverrides.length,
          clearedFieldCount: payload.clearedFields.length,
        },
      },
    });
  });
}

export function applyHubspotPreparationRows(input: {
  run: Pick<
    HubspotPreparationRun,
    | "currency"
    | "dealType"
    | "activationType"
    | "hubspotInfluencerType"
    | "hubspotInfluencerVertical"
    | "hubspotCountryRegion"
    | "hubspotLanguage"
    | "rowOverrides"
  >;
  rows: Array<{ rowKey: string; fallbackValues: Record<string, string> }>;
}): ExportPreviewRow[] {
  const defaults = normalizeHubspotPrepDefaults(input.run);
  const rowOverrideMap = getRowOverrideMap(input.run);

  return input.rows.map((row) => ({
    id: row.rowKey,
    rowKey: row.rowKey,
    channelId: row.fallbackValues.channelId ?? "",
    channelTitle: row.fallbackValues.channelTitle ?? "",
    values: resolveHubspotRowValues({
      defaults,
      fallbackValues: row.fallbackValues,
      rowOverride: rowOverrideMap.get(row.rowKey) ?? null,
    }),
  }));
}
