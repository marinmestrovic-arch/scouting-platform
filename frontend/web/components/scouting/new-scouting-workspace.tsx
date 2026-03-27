"use client";

import type { CampaignManagerOption, CampaignSummary } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useState } from "react";

import { createRun } from "../../lib/runs-api";
import { getCreateRunErrorMessage, normalizeRunDraft, normalizeRunTarget } from "../runs/create-run-shell";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type NewScoutingWorkspaceProps = Readonly<{
  initialCampaigns?: CampaignSummary[] | undefined;
  initialCampaignManagers?: CampaignManagerOption[] | undefined;
  showLegacyNotice?: boolean;
}>;

type NewScoutingDraft = {
  name: string;
  prompt: string;
  target: string;
  campaignId: string;
  campaignManagerUserId: string;
};

type NewScoutingRequestState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

const DEFAULT_REQUEST_STATE: NewScoutingRequestState = {
  status: "idle",
  message: "Pick an active campaign and start a scouting list with the minimum required input.",
};

export function NewScoutingWorkspace({
  initialCampaigns = [],
  initialCampaignManagers = [],
  showLegacyNotice = false,
}: NewScoutingWorkspaceProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<NewScoutingDraft>({
    name: "",
    prompt: "",
    target: "",
    campaignId: "",
    campaignManagerUserId: "",
  });
  const [requestState, setRequestState] = useState<NewScoutingRequestState>(DEFAULT_REQUEST_STATE);
  const isBusy = requestState.status === "submitting";
  const campaignOptions: SearchableSelectOption[] = [
    {
      value: "",
      label: initialCampaigns.length === 0 ? "No active campaigns available" : "Select campaign",
      disabled: initialCampaigns.length === 0,
    },
    ...initialCampaigns.map((campaign) => ({
      value: campaign.id,
      label: `${campaign.name} · ${campaign.client.name} · ${campaign.market.name}`,
      keywords: [campaign.name, campaign.client.name, campaign.market.name],
    })),
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
      const normalizedDraft = normalizeRunDraft({
        name: draft.name,
        query: draft.prompt,
        target: draft.target,
      });
      const normalizedTarget = normalizeRunTarget(draft.target);

      if (!normalizedDraft.name || !normalizedDraft.query || normalizedTarget === null) {
        throw new Error("Influencer List, target, and prompt are required.");
      }

      if (!draft.campaignId) {
        throw new Error("Campaign is required.");
      }

      if (!draft.campaignManagerUserId) {
        throw new Error("Campaign Manager is required.");
      }

      const response = await createRun({
        name: normalizedDraft.name,
        query: normalizedDraft.query,
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
              onChange={(event) => updateDraftField("target", event.currentTarget.value)}
              placeholder="25"
              required
              step={1}
              type="number"
              value={draft.target}
            />
            <small>Number of creators needed for this scouting list.</small>
          </label>
        </div>

        <label className="new-scouting__field">
          <span>Prompt</span>
          <textarea
            disabled={isBusy}
            maxLength={500}
            onChange={(event) => updateDraftField("prompt", event.currentTarget.value)}
            placeholder="Gaming creators with strong strategy content and DACH audience relevance"
            required
            rows={7}
            value={draft.prompt}
          />
        </label>

        <p
          className={`new-scouting__status new-scouting__status--${requestState.status}`}
          role={requestState.status === "error" ? "alert" : "status"}
        >
          {requestState.message}
        </p>

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
