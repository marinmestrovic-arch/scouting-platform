"use client";

import type { CampaignManagerOption, RunMonth } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useEffect, useState } from "react";

import { fetchCampaignManagers } from "../../lib/campaign-managers-api";
import { RUN_MONTH_OPTIONS } from "../../lib/run-metadata";
import { createRun } from "../../lib/runs-api";
import { getCreateRunErrorMessage, normalizeRunDraft, normalizeRunTarget } from "../runs/create-run-shell";

type NewScoutingWorkspaceProps = Readonly<{
  showLegacyNotice?: boolean;
}>;

type NewScoutingDraft = {
  name: string;
  prompt: string;
  target: string;
  client: string;
  market: string;
  campaignManagerUserId: string;
  briefLink: string;
  campaignName: string;
  month: "" | RunMonth;
  year: string;
  dealOwner: string;
  dealName: string;
  pipeline: string;
  dealStage: string;
  currency: string;
  dealType: string;
  activationType: string;
};

type NewScoutingRequestState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

type CampaignManagersRequestState = {
  status: "loading" | "ready" | "error";
  items: CampaignManagerOption[];
  error: string | null;
};

type NewScoutingWorkspaceViewProps = NewScoutingWorkspaceProps & {
  campaignManagersState: CampaignManagersRequestState;
  draft: NewScoutingDraft;
  requestState: NewScoutingRequestState;
  onFieldChange: <Field extends keyof NewScoutingDraft>(
    field: Field,
    value: NewScoutingDraft[Field],
  ) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function getDefaultMonth(): RunMonth {
  const index = new Date().getUTCMonth();
  return RUN_MONTH_OPTIONS[index]?.value ?? "january";
}

const DEFAULT_DRAFT: NewScoutingDraft = {
  name: "",
  prompt: "",
  target: "",
  client: "",
  market: "",
  campaignManagerUserId: "",
  briefLink: "",
  campaignName: "",
  month: getDefaultMonth(),
  year: String(new Date().getUTCFullYear()),
  dealOwner: "",
  dealName: "",
  pipeline: "",
  dealStage: "",
  currency: "",
  dealType: "",
  activationType: "",
};

const IDLE_REQUEST_STATE: NewScoutingRequestState = {
  status: "idle",
  message:
    "This workspace now stores the live campaign metadata required for Dashboard filtering and HubSpot import readiness.",
};

const SUBMITTING_REQUEST_STATE: NewScoutingRequestState = {
  status: "submitting",
  message: "Creating the scouting run and opening it inside Database.",
};

const INITIAL_CAMPAIGN_MANAGERS_STATE: CampaignManagersRequestState = {
  status: "loading",
  items: [],
  error: null,
};

function getCampaignManagerLabel(option: CampaignManagerOption): string {
  return option.name?.trim() || option.email;
}

export function NewScoutingWorkspaceView({
  campaignManagersState,
  draft,
  onFieldChange,
  onSubmit,
  requestState,
  showLegacyNotice = false,
}: NewScoutingWorkspaceViewProps) {
  const isBusy = requestState.status === "submitting";
  const campaignManagerHelpText =
    campaignManagersState.status === "error"
      ? campaignManagersState.error ?? "Unable to load campaign manager options."
      : campaignManagersState.status === "loading"
        ? "Loading campaign manager options."
        : "Only active users with user type Campaign Manager appear here.";

  return (
    <div className="new-scouting">
      {showLegacyNotice ? (
        <section className="workspace-callout">
          <h3>Legacy route</h3>
          <p>
            This page is the compatibility shortcut for the new scouting workspace. The primary
            entry lives at <code>/new-scouting</code>.
          </p>
        </section>
      ) : null}

      <form className="new-scouting__panel" onSubmit={onSubmit} suppressHydrationWarning>
        <label className="new-scouting__field">
          <span>Influencer List</span>
          <input
            autoComplete="off"
            disabled={isBusy}
            maxLength={200}
            name="name"
            onChange={(event) => onFieldChange("name", event.currentTarget.value)}
            placeholder="Spring gaming outreach"
            required
            suppressHydrationWarning
            value={draft.name}
          />
          <small>This name becomes the run label across Dashboard, Database, and exports.</small>
        </label>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Client</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="client"
              onChange={(event) => onFieldChange("client", event.currentTarget.value)}
              placeholder="Sony"
              required
              suppressHydrationWarning
              value={draft.client}
            />
          </label>

          <label className="new-scouting__field">
            <span>Market</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="market"
              onChange={(event) => onFieldChange("market", event.currentTarget.value)}
              placeholder="DACH"
              required
              suppressHydrationWarning
              value={draft.market}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Campaign manager</span>
            <select
              disabled={isBusy || campaignManagersState.status === "loading"}
              name="campaignManagerUserId"
              onChange={(event) => onFieldChange("campaignManagerUserId", event.currentTarget.value)}
              required
              suppressHydrationWarning
              value={draft.campaignManagerUserId}
            >
              <option value="">
                {campaignManagersState.status === "loading"
                  ? "Loading campaign managers..."
                  : "Select campaign manager"}
              </option>
              {campaignManagersState.items.map((option) => (
                <option key={option.id} value={option.id}>
                  {getCampaignManagerLabel(option)}
                </option>
              ))}
            </select>
            <small>{campaignManagerHelpText}</small>
          </label>

          <label className="new-scouting__field">
            <span>Brief link</span>
            <input
              disabled={isBusy}
              inputMode="url"
              maxLength={2048}
              name="briefLink"
              onChange={(event) => onFieldChange("briefLink", event.currentTarget.value)}
              placeholder="https://docs.google.com/..."
              suppressHydrationWarning
              type="url"
              value={draft.briefLink}
            />
            <small>Optional. This stays visible from the Dashboard table.</small>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Campaign name</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="campaignName"
              onChange={(event) => onFieldChange("campaignName", event.currentTarget.value)}
              placeholder="Spring Launch 2026"
              required
              suppressHydrationWarning
              value={draft.campaignName}
            />
          </label>

          <label className="new-scouting__field">
            <span>Target</span>
            <input
              disabled={isBusy}
              inputMode="numeric"
              min={1}
              name="target"
              onChange={(event) => onFieldChange("target", event.currentTarget.value)}
              placeholder="25"
              required
              step={1}
              suppressHydrationWarning
              type="number"
              value={draft.target}
            />
            <small>Number of creators needed for this scouting list.</small>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Month</span>
            <select
              disabled={isBusy}
              name="month"
              onChange={(event) => onFieldChange("month", event.currentTarget.value as "" | RunMonth)}
              required
              suppressHydrationWarning
              value={draft.month}
            >
              {RUN_MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="new-scouting__field">
            <span>Year</span>
            <input
              disabled={isBusy}
              inputMode="numeric"
              max={2100}
              min={2000}
              name="year"
              onChange={(event) => onFieldChange("year", event.currentTarget.value)}
              placeholder="2026"
              required
              suppressHydrationWarning
              type="number"
              value={draft.year}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Deal owner</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="dealOwner"
              onChange={(event) => onFieldChange("dealOwner", event.currentTarget.value)}
              placeholder="Marin Mestrovic"
              required
              suppressHydrationWarning
              value={draft.dealOwner}
            />
          </label>

          <label className="new-scouting__field">
            <span>Deal name</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="dealName"
              onChange={(event) => onFieldChange("dealName", event.currentTarget.value)}
              placeholder="Sony Gaming Q2"
              required
              suppressHydrationWarning
              value={draft.dealName}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--three">
          <label className="new-scouting__field">
            <span>Pipeline</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="pipeline"
              onChange={(event) => onFieldChange("pipeline", event.currentTarget.value)}
              placeholder="New business"
              required
              suppressHydrationWarning
              value={draft.pipeline}
            />
          </label>

          <label className="new-scouting__field">
            <span>Deal stage</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="dealStage"
              onChange={(event) => onFieldChange("dealStage", event.currentTarget.value)}
              placeholder="Contract sent"
              required
              suppressHydrationWarning
              value={draft.dealStage}
            />
          </label>

          <label className="new-scouting__field">
            <span>Currency</span>
            <input
              disabled={isBusy}
              maxLength={50}
              name="currency"
              onChange={(event) => onFieldChange("currency", event.currentTarget.value)}
              placeholder="EUR"
              required
              suppressHydrationWarning
              value={draft.currency}
            />
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Deal type</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="dealType"
              onChange={(event) => onFieldChange("dealType", event.currentTarget.value)}
              placeholder="Paid social"
              required
              suppressHydrationWarning
              value={draft.dealType}
            />
          </label>

          <label className="new-scouting__field">
            <span>Activation type</span>
            <input
              disabled={isBusy}
              maxLength={200}
              name="activationType"
              onChange={(event) => onFieldChange("activationType", event.currentTarget.value)}
              placeholder="YouTube integration"
              required
              suppressHydrationWarning
              value={draft.activationType}
            />
          </label>
        </div>

        <label className="new-scouting__field">
          <span>Prompt</span>
          <textarea
            disabled={isBusy}
            maxLength={500}
            name="prompt"
            onChange={(event) => onFieldChange("prompt", event.currentTarget.value)}
            placeholder="Gaming creators with strong strategy content and DACH audience relevance"
            required
            rows={7}
            suppressHydrationWarning
            value={draft.prompt}
          />
          <small>This prompt becomes the stored run query used by discovery and later review.</small>
        </label>

        <p
          className={`new-scouting__status new-scouting__status--${requestState.status}`}
          role={requestState.status === "error" ? "alert" : "status"}
        >
          {requestState.message}
        </p>

        <div className="new-scouting__actions">
          <button
            disabled={
              isBusy ||
              campaignManagersState.status === "loading" ||
              campaignManagersState.items.length === 0
            }
            suppressHydrationWarning
            type="submit"
          >
            {isBusy ? "Starting scouting..." : "Start scouting"}
          </button>

          <Link className="new-scouting__secondary-link" href="/database?tab=runs">
            Open Database
          </Link>
        </div>
      </form>
    </div>
  );
}

export function NewScoutingWorkspace({
  showLegacyNotice = false,
}: NewScoutingWorkspaceProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<NewScoutingDraft>(DEFAULT_DRAFT);
  const [requestState, setRequestState] = useState<NewScoutingRequestState>(IDLE_REQUEST_STATE);
  const [campaignManagersState, setCampaignManagersState] = useState<CampaignManagersRequestState>(
    INITIAL_CAMPAIGN_MANAGERS_STATE,
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadCampaignManagers(): Promise<void> {
      try {
        const items = await fetchCampaignManagers(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setCampaignManagersState({
          status: "ready",
          items,
          error: null,
        });
        setDraft((current) =>
          current.campaignManagerUserId || items.length === 0
            ? current
            : {
                ...current,
                campaignManagerUserId: items[0]?.id ?? "",
              },
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setCampaignManagersState({
          status: "error",
          items: [],
          error: error instanceof Error ? error.message : "Unable to load campaign managers.",
        });
      }
    }

    void loadCampaignManagers();

    return () => {
      abortController.abort();
    };
  }, []);

  function handleFieldChange<Field extends keyof NewScoutingDraft>(
    field: Field,
    value: NewScoutingDraft[Field],
  ) {
    if (requestState.status === "error") {
      setRequestState(IDLE_REQUEST_STATE);
    }

    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState(SUBMITTING_REQUEST_STATE);

    try {
      const normalizedDraft = normalizeRunDraft({
        name: draft.name,
        query: draft.prompt,
        target: draft.target,
      });
      const normalizedTarget = normalizeRunTarget(draft.target);
      const normalizedYear = Number.parseInt(draft.year.trim(), 10);

      if (!normalizedDraft.name || !normalizedDraft.query || normalizedTarget === null) {
        throw new Error("Influencer List, target, and prompt are required.");
      }

      if (!draft.campaignManagerUserId) {
        throw new Error("Campaign manager is required.");
      }

      if (!draft.month) {
        throw new Error("Month is required.");
      }

      if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2100) {
        throw new Error("Year must be between 2000 and 2100.");
      }

      const response = await createRun({
        name: normalizedDraft.name,
        query: normalizedDraft.query,
        target: normalizedTarget,
        metadata: {
          client: draft.client.trim(),
          market: draft.market.trim(),
          campaignManagerUserId: draft.campaignManagerUserId,
          briefLink: draft.briefLink.trim() || undefined,
          campaignName: draft.campaignName.trim(),
          month: draft.month,
          year: normalizedYear,
          dealOwner: draft.dealOwner.trim(),
          dealName: draft.dealName.trim(),
          pipeline: draft.pipeline.trim(),
          dealStage: draft.dealStage.trim(),
          currency: draft.currency.trim(),
          dealType: draft.dealType.trim(),
          activationType: draft.activationType.trim(),
        },
      });

      startTransition(() => {
        router.push(`/database?tab=runs&runId=${encodeURIComponent(response.runId)}`);
      });
    } catch (error) {
      setRequestState({
        status: "error",
        message: getCreateRunErrorMessage(error),
      });
    }
  }

  return (
    <NewScoutingWorkspaceView
      campaignManagersState={campaignManagersState}
      draft={draft}
      onFieldChange={handleFieldChange}
      onSubmit={handleSubmit}
      requestState={requestState}
      showLegacyNotice={showLegacyNotice}
    />
  );
}
