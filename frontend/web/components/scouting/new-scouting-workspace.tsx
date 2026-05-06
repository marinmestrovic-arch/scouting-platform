"use client";

import {
  buildCatalogScoutingQuery,
  EMPTY_CATALOG_SCOUTING_CRITERIA,
  hasCatalogScoutingCriteria,
  type CampaignManagerOption,
  type CampaignSummary,
  type CatalogScoutingCriteria,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useMemo, useState } from "react";

import { createRun } from "../../lib/runs-api";
import { getCreateRunErrorMessage, normalizeRunTarget } from "../runs/create-run-shell";
import { SearchableMultiSelect, type SearchableMultiSelectOption } from "../ui/searchable-multi-select";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type NewScoutingWorkspaceProps = Readonly<{
  initialCampaigns?: CampaignSummary[] | undefined;
  initialCampaignManagers?: CampaignManagerOption[] | undefined;
  initialCountryRegionOptions?: string[] | undefined;
  initialLanguageOptions?: string[] | undefined;
  initialInfluencerVerticalOptions?: string[] | undefined;
  showLegacyNotice?: boolean;
}>;

type NewScoutingDraft = {
  name: string;
  target: string;
  campaignId: string;
  campaignManagerUserId: string;
} & CatalogScoutingCriteria;

type NewScoutingRequestState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

type MetricRangeSelection = Readonly<{
  minIndex: number;
  maxIndex: number;
}>;

const DEFAULT_REQUEST_STATE: NewScoutingRequestState = {
  status: "idle",
  message: "",
};

const METRIC_SLIDER_STEPS = [
  1000,
  2500,
  5000,
  10000,
  25000,
  50000,
  100000,
  250000,
  500000,
  750000,
  1000000,
] as const;

const LAST_METRIC_SLIDER_INDEX = METRIC_SLIDER_STEPS.length - 1;
const MULTI_VALUE_SEPARATOR = " | ";

function formatMetricStep(value: number): string {
  if (value >= 1000000) {
    return "1M";
  }

  if (value >= 1000) {
    return `${Number.parseFloat((value / 1000).toFixed(1)).toString()}K`;
  }

  return String(value);
}

function parseMetricValue(rawValue: string): number | null {
  const normalized = rawValue.trim().toLowerCase().replaceAll(",", "").replace(/\s+/g, "");

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);

  if (!match || !match[1]) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const multiplier =
    match[2] === "k" ? 1000 : match[2] === "m" ? 1000000 : match[2] === "b" ? 1000000000 : 1;

  return Math.round(numeric * multiplier);
}

function getNearestMetricStepIndex(value: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, step] of METRIC_SLIDER_STEPS.entries()) {
    const distance = Math.abs(step - value);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function parseMetricRangeSelection(value: string): MetricRangeSelection {
  const normalized = value.trim().toLowerCase().replaceAll(",", "").replace(/\s+/g, "");

  if (!normalized) {
    return {
      minIndex: 0,
      maxIndex: LAST_METRIC_SLIDER_INDEX,
    };
  }

  const plusMatch = normalized.match(/^(.+)\+$/);

  if (plusMatch?.[1]) {
    const minimum = parseMetricValue(plusMatch[1]);

    if (minimum !== null) {
      return {
        minIndex: getNearestMetricStepIndex(minimum),
        maxIndex: LAST_METRIC_SLIDER_INDEX,
      };
    }
  }

  const rangeMatch = normalized.match(/^([0-9]+(?:\.\d+)?[kmb]?)(?:-|to)([0-9]+(?:\.\d+)?[kmb]?)$/);

  if (rangeMatch?.[1] && rangeMatch[2]) {
    const first = parseMetricValue(rangeMatch[1]);
    const second = parseMetricValue(rangeMatch[2]);

    if (first !== null && second !== null) {
      const firstIndex = getNearestMetricStepIndex(first);
      const secondIndex = getNearestMetricStepIndex(second);

      return {
        minIndex: Math.min(firstIndex, secondIndex),
        maxIndex: Math.max(firstIndex, secondIndex),
      };
    }
  }

  const minimum = parseMetricValue(normalized);

  if (minimum === null) {
    return {
      minIndex: 0,
      maxIndex: LAST_METRIC_SLIDER_INDEX,
    };
  }

  return {
    minIndex: getNearestMetricStepIndex(minimum),
    maxIndex: LAST_METRIC_SLIDER_INDEX,
  };
}

function buildMetricCriteriaFromRange(selection: MetricRangeSelection): string {
  const boundedMinIndex = Math.max(0, Math.min(selection.minIndex, LAST_METRIC_SLIDER_INDEX));
  const boundedMaxIndex = Math.max(0, Math.min(selection.maxIndex, LAST_METRIC_SLIDER_INDEX));
  const minIndex = Math.min(boundedMinIndex, boundedMaxIndex);
  const maxIndex = Math.max(boundedMinIndex, boundedMaxIndex);
  const minValue = METRIC_SLIDER_STEPS[minIndex];
  const maxValue = METRIC_SLIDER_STEPS[maxIndex];

  if (minValue === undefined || maxValue === undefined) {
    return "";
  }

  if (minIndex === 0 && maxIndex === LAST_METRIC_SLIDER_INDEX) {
    return "";
  }

  if (maxIndex === LAST_METRIC_SLIDER_INDEX) {
    return `${formatMetricStep(minValue)}+`;
  }

  return `${formatMetricStep(minValue)}-${formatMetricStep(maxValue)}`;
}

function formatMetricRangeSummary(selection: MetricRangeSelection): string {
  const minValue = METRIC_SLIDER_STEPS[selection.minIndex];
  const maxValue = METRIC_SLIDER_STEPS[selection.maxIndex];

  if (minValue === undefined || maxValue === undefined) {
    return "Any";
  }

  if (selection.minIndex === 0 && selection.maxIndex === LAST_METRIC_SLIDER_INDEX) {
    return "Any";
  }

  const minLabel = formatMetricStep(minValue);
  const maxLabel = selection.maxIndex === LAST_METRIC_SLIDER_INDEX ? "1M+" : formatMetricStep(maxValue);

  return `${minLabel} - ${maxLabel}`;
}

function parseMultiValueSelection(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  return value
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function joinMultiValueSelection(values: readonly string[]): string {
  return values.join(MULTI_VALUE_SEPARATOR);
}

function normalizeDropdownValues(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function NewScoutingWorkspace({
  initialCampaigns = [],
  initialCampaignManagers = [],
  initialCountryRegionOptions = [],
  initialLanguageOptions = [],
  initialInfluencerVerticalOptions = [],
  showLegacyNotice = false,
}: NewScoutingWorkspaceProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<NewScoutingDraft>({
    name: "",
    target: "",
    campaignId: "",
    campaignManagerUserId: "",
    ...EMPTY_CATALOG_SCOUTING_CRITERIA,
  });
  const [requestState, setRequestState] = useState<NewScoutingRequestState>(DEFAULT_REQUEST_STATE);
  const isBusy = requestState.status === "submitting";
  const campaignOptions: SearchableSelectOption[] = [
    {
      value: "",
      label: initialCampaigns.length === 0 ? "No active campaigns available" : "Select campaign",
      disabled: initialCampaigns.length === 0,
    },
    ...initialCampaigns.map((campaign) => {
      const clientLabel = campaign.client?.name ?? "No client";
      const marketsLabel = campaign.market?.name ?? "No markets";

      return {
        value: campaign.id,
        label: `${campaign.name} · ${clientLabel} · ${marketsLabel}`,
        keywords: [campaign.name, clientLabel, marketsLabel],
      };
    }),
  ];
  const campaignManagerOptions: SearchableSelectOption[] = [
    {
      value: "",
      label: initialCampaignManagers.length === 0 ? "No campaign managers available" : "Select campaign manager",
      disabled: initialCampaignManagers.length === 0,
    },
    ...initialCampaignManagers.map((campaignManager) => ({
      value: campaignManager.id,
      label: campaignManager.name?.trim() || campaignManager.email,
      keywords: [campaignManager.email],
    })),
  ];
  const countryRegionOptions = useMemo(
    () => normalizeDropdownValues(initialCountryRegionOptions),
    [initialCountryRegionOptions],
  );
  const languageOptions = useMemo(
    () => normalizeDropdownValues(initialLanguageOptions),
    [initialLanguageOptions],
  );
  const influencerVerticalOptions = useMemo(
    () => normalizeDropdownValues(initialInfluencerVerticalOptions),
    [initialInfluencerVerticalOptions],
  );
  const locationMultiSelectOptions = useMemo<SearchableMultiSelectOption[]>(
    () => countryRegionOptions.map((value) => ({ value, label: value, keywords: [value] })),
    [countryRegionOptions],
  );
  const languageSelectOptions = useMemo<SearchableSelectOption[]>(
    () => languageOptions.map((value) => ({ value, label: value, keywords: [value] })),
    [languageOptions],
  );
  const influencerVerticalSelectOptions = useMemo<SearchableSelectOption[]>(
    () => influencerVerticalOptions.map((value) => ({ value, label: value, keywords: [value] })),
    [influencerVerticalOptions],
  );
  const selectedLocations = useMemo(() => parseMultiValueSelection(draft.location), [draft.location]);
  const subscribersRange = useMemo(() => parseMetricRangeSelection(draft.subscribers), [draft.subscribers]);
  const viewsRange = useMemo(() => parseMetricRangeSelection(draft.views), [draft.views]);
  const subscribersRangeStart = (subscribersRange.minIndex / LAST_METRIC_SLIDER_INDEX) * 100;
  const subscribersRangeEnd = (subscribersRange.maxIndex / LAST_METRIC_SLIDER_INDEX) * 100;
  const viewsRangeStart = (viewsRange.minIndex / LAST_METRIC_SLIDER_INDEX) * 100;
  const viewsRangeEnd = (viewsRange.maxIndex / LAST_METRIC_SLIDER_INDEX) * 100;

  function updateDraftField<Key extends keyof NewScoutingDraft>(field: Key, value: NewScoutingDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState({
      status: "submitting",
      message: "Creating the scouting run.",
    });

    try {
      const normalizedName = draft.name.trim();
      const normalizedTarget = normalizeRunTarget(draft.target);
      const hasCriteria = hasCatalogScoutingCriteria(draft);

      if (!normalizedName || !hasCriteria || normalizedTarget === null) {
        throw new Error("Influencer List, target, and at least one catalog criterion are required.");
      }

      if (!draft.campaignId) {
        throw new Error("Campaign is required.");
      }

      if (!draft.campaignManagerUserId) {
        throw new Error("Campaign Manager is required.");
      }

      const response = await createRun({
        name: normalizedName,
        query: buildCatalogScoutingQuery(draft),
        target: normalizedTarget,
        metadata: {
          campaignId: draft.campaignId,
          campaignManagerUserId: draft.campaignManagerUserId,
        },
      });

      startTransition(() => {
        router.push(`/runs/${encodeURIComponent(response.runId)}`);
      });
    } catch (error) {
      setRequestState({
        status: "error",
        message: getCreateRunErrorMessage(error),
      });
    }
  }

  return (
    <div className="new-scouting">
      {showLegacyNotice ? (
        <section className="workspace-callout">
          <h3>Legacy route</h3>
          <p>This page remains available as a shortcut to the campaign-based scouting flow.</p>
        </section>
      ) : null}

      <form className="new-scouting__panel" onSubmit={handleSubmit}>
        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Influencer List</span>
            <input
              autoComplete="off"
              disabled={isBusy}
              maxLength={200}
              name="name"
              onChange={(event) => updateDraftField("name", event.currentTarget.value)}
              placeholder="Spring gaming outreach"
              required
              value={draft.name}
            />
          </label>

          <label className="new-scouting__field">
            <span>Campaign</span>
            <SearchableSelect
              ariaLabel="Campaign"
              disabled={isBusy || initialCampaigns.length === 0}
              onChange={(campaignId) => updateDraftField("campaignId", campaignId)}
              options={campaignOptions}
              placeholder={initialCampaigns.length === 0 ? "No active campaigns available" : "Select campaign"}
              searchPlaceholder="Search campaigns..."
              value={draft.campaignId}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Campaign Manager</span>
            <SearchableSelect
              ariaLabel="Campaign Manager"
              disabled={isBusy || initialCampaignManagers.length === 0}
              onChange={(campaignManagerUserId) => updateDraftField("campaignManagerUserId", campaignManagerUserId)}
              options={campaignManagerOptions}
              placeholder={initialCampaignManagers.length === 0 ? "No campaign managers available" : "Select campaign manager"}
              searchPlaceholder="Search campaign managers..."
              value={draft.campaignManagerUserId}
            />
          </label>

          <label className="new-scouting__field">
            <span>Target</span>
            <input
              disabled={isBusy}
              inputMode="numeric"
              min={1}
              name="target"
              onChange={(event) => updateDraftField("target", event.currentTarget.value)}
              placeholder="25"
              required
              step={1}
              type="number"
              value={draft.target}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Subscribers</span>
            <div className="new-scouting__range-control">
              <div className="new-scouting__range-meta">
                <span className="new-scouting__range-value">{formatMetricRangeSummary(subscribersRange)}</span>
              </div>
              <div
                className="new-scouting__dual-range"
                style={{
                  "--new-scouting-range-start": `${subscribersRangeStart}%`,
                  "--new-scouting-range-end": `${subscribersRangeEnd}%`,
                } as React.CSSProperties}
              >
                <div className="new-scouting__dual-range-track" />
                <input
                  aria-label="Subscribers minimum"
                  className="new-scouting__dual-range-input"
                  disabled={isBusy}
                  max={LAST_METRIC_SLIDER_INDEX}
                  min={0}
                  name="subscribersMin"
                  onChange={(event) => {
                    const nextMinIndex = Math.min(Number(event.currentTarget.value), subscribersRange.maxIndex);
                    updateDraftField(
                      "subscribers",
                      buildMetricCriteriaFromRange({ minIndex: nextMinIndex, maxIndex: subscribersRange.maxIndex }),
                    );
                  }}
                  step={1}
                  type="range"
                  value={subscribersRange.minIndex}
                />
                <input
                  aria-label="Subscribers maximum"
                  className="new-scouting__dual-range-input"
                  disabled={isBusy}
                  max={LAST_METRIC_SLIDER_INDEX}
                  min={0}
                  name="subscribersMax"
                  onChange={(event) => {
                    const nextMaxIndex = Math.max(Number(event.currentTarget.value), subscribersRange.minIndex);
                    updateDraftField(
                      "subscribers",
                      buildMetricCriteriaFromRange({ minIndex: subscribersRange.minIndex, maxIndex: nextMaxIndex }),
                    );
                  }}
                  step={1}
                  type="range"
                  value={subscribersRange.maxIndex}
                />
              </div>
            </div>
          </label>

          <label className="new-scouting__field">
            <span>Views</span>
            <div className="new-scouting__range-control">
              <div className="new-scouting__range-meta">
                <span className="new-scouting__range-value">{formatMetricRangeSummary(viewsRange)}</span>
              </div>
              <div
                className="new-scouting__dual-range"
                style={{
                  "--new-scouting-range-start": `${viewsRangeStart}%`,
                  "--new-scouting-range-end": `${viewsRangeEnd}%`,
                } as React.CSSProperties}
              >
                <div className="new-scouting__dual-range-track" />
                <input
                  aria-label="Views minimum"
                  className="new-scouting__dual-range-input"
                  disabled={isBusy}
                  max={LAST_METRIC_SLIDER_INDEX}
                  min={0}
                  name="viewsMin"
                  onChange={(event) => {
                    const nextMinIndex = Math.min(Number(event.currentTarget.value), viewsRange.maxIndex);
                    updateDraftField(
                      "views",
                      buildMetricCriteriaFromRange({ minIndex: nextMinIndex, maxIndex: viewsRange.maxIndex }),
                    );
                  }}
                  step={1}
                  type="range"
                  value={viewsRange.minIndex}
                />
                <input
                  aria-label="Views maximum"
                  className="new-scouting__dual-range-input"
                  disabled={isBusy}
                  max={LAST_METRIC_SLIDER_INDEX}
                  min={0}
                  name="viewsMax"
                  onChange={(event) => {
                    const nextMaxIndex = Math.max(Number(event.currentTarget.value), viewsRange.minIndex);
                    updateDraftField(
                      "views",
                      buildMetricCriteriaFromRange({ minIndex: viewsRange.minIndex, maxIndex: nextMaxIndex }),
                    );
                  }}
                  step={1}
                  type="range"
                  value={viewsRange.maxIndex}
                />
              </div>
            </div>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Location</span>
            <SearchableMultiSelect
              ariaLabel="Location"
              disabled={isBusy || locationMultiSelectOptions.length === 0}
              onChange={(values) => updateDraftField("location", joinMultiValueSelection(values))}
              options={locationMultiSelectOptions}
              placeholder={
                locationMultiSelectOptions.length === 0 ? "No Country/Region values available" : "Select one or more locations"
              }
              searchPlaceholder="Search locations..."
              values={selectedLocations}
            />
          </label>

          <label className="new-scouting__field">
            <span>Language</span>
            <SearchableSelect
              ariaLabel="Language"
              disabled={isBusy || languageSelectOptions.length === 0}
              onChange={(language) => updateDraftField("language", language)}
              options={languageSelectOptions}
              placeholder={languageSelectOptions.length === 0 ? "No Language values available" : "Select language"}
              searchPlaceholder="Search languages..."
              value={draft.language}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Last post day since</span>
            <input
              disabled={isBusy}
              inputMode="numeric"
              min={0}
              name="lastPostDaysSince"
              onChange={(event) => updateDraftField("lastPostDaysSince", event.currentTarget.value)}
              placeholder="30"
              step={1}
              type="number"
              value={draft.lastPostDaysSince}
            />
          </label>

          <label className="new-scouting__field">
            <span>Influencer Vertical</span>
            <SearchableSelect
              ariaLabel="Influencer Vertical"
              disabled={isBusy || influencerVerticalSelectOptions.length === 0}
              onChange={(value) => updateDraftField("category", value)}
              options={influencerVerticalSelectOptions}
              placeholder={
                influencerVerticalSelectOptions.length === 0
                  ? "No Influencer Vertical values available"
                  : "Select influencer vertical"
              }
              searchPlaceholder="Search influencer verticals..."
              value={draft.category}
            />
          </label>
        </div>

        <label className="new-scouting__field">
          <span>Niche</span>
          <input
            autoComplete="off"
            disabled={isBusy}
            maxLength={120}
            name="niche"
            onChange={(event) => updateDraftField("niche", event.currentTarget.value)}
            placeholder="e.g. Competitive shooters, strategy RPGs"
            value={draft.niche}
          />
        </label>

        {requestState.message ? (
          <p
            className={`new-scouting__status new-scouting__status--${requestState.status}`}
            role={requestState.status === "error" ? "alert" : "status"}
          >
            {requestState.message}
          </p>
        ) : null}

        <div className="new-scouting__actions">
          <button
            disabled={isBusy || initialCampaigns.length === 0 || initialCampaignManagers.length === 0}
            type="submit"
          >
            {isBusy ? "Starting scouting..." : "Start scouting"}
          </button>

          <Link className="new-scouting__secondary-link" href="/database?tab=campaigns">
            Open campaigns
          </Link>
        </div>
      </form>
    </div>
  );
}

export function NewScoutingWorkspaceView(props: NewScoutingWorkspaceProps) {
  return <NewScoutingWorkspace {...props} />;
}
