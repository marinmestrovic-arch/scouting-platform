"use client";

import type { CampaignManagerOption, CampaignSummary } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useState } from "react";

import { createRun } from "../../lib/runs-api";
import { getCreateRunErrorMessage, normalizeRunDraft, normalizeRunTarget } from "../runs/create-run-shell";

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
        <div className="page-hero">
          <div>
            <p className="workspace-eyebrow">Campaign-based scouting</p>
            <h2>Start a new scouting list</h2>
            <p className="workspace-copy">
              Campaign metadata now comes from the Campaigns database, so run creation only needs
              the list name, campaign, target, and search prompt.
            </p>
          </div>
        </div>

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
            <select
              disabled={isBusy || initialCampaigns.length === 0}
              onChange={(event) => updateDraftField("campaignId", event.currentTarget.value)}
              required
              value={draft.campaignId}
            >
              <option value="">
                {initialCampaigns.length === 0 ? "No active campaigns available" : "Select campaign"}
              </option>
              {initialCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} · {campaign.client.name} · {campaign.market.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Campaign Manager</span>
            <select
              disabled={isBusy || initialCampaignManagers.length === 0}
              onChange={(event) => updateDraftField("campaignManagerUserId", event.currentTarget.value)}
              required
              value={draft.campaignManagerUserId}
            >
              <option value="">
                {initialCampaignManagers.length === 0
                  ? "No campaign managers available"
                  : "Select campaign manager"}
              </option>
              {initialCampaignManagers.map((campaignManager) => (
                <option key={campaignManager.id} value={campaignManager.id}>
                  {campaignManager.name?.trim() || campaignManager.email}
                </option>
              ))}
            </select>
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
