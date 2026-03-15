"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useState } from "react";

import { createRun } from "../../lib/runs-api";
import { getCreateRunErrorMessage } from "../runs/create-run-shell";

type NewScoutingWorkspaceProps = Readonly<{
  showLegacyNotice?: boolean;
}>;

type NewScoutingDraft = {
  prompt: string;
};

type NewScoutingRequestState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

type NewScoutingWorkspaceViewProps = NewScoutingWorkspaceProps & {
  draft: NewScoutingDraft;
  requestState: NewScoutingRequestState;
  onPromptChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
};

const DEFAULT_DRAFT: NewScoutingDraft = {
  prompt: "",
};

const IDLE_REQUEST_STATE: NewScoutingRequestState = {
  status: "idle",
  message:
    "Only the prompt is live today. Campaign, week, brief, and targeting controls are scaffolded until the backend stores those fields.",
};

const SUBMITTING_REQUEST_STATE: NewScoutingRequestState = {
  status: "submitting",
  message: "Creating the scouting run and opening it inside Database.",
};

function normalizePrompt(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildGeneratedRunName(prompt: string): string {
  const normalized = normalizePrompt(prompt);

  if (!normalized) {
    return "Scouting run";
  }

  const preview =
    normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;

  return `Scouting: ${preview}`;
}

export function NewScoutingWorkspaceView({
  draft,
  onPromptChange,
  onSubmit,
  requestState,
  showLegacyNotice = false,
}: NewScoutingWorkspaceViewProps) {
  const isBusy = requestState.status === "submitting";

  return (
    <div className="new-scouting">
      <section className="new-scouting__hero">
        <div>
          <p className="workspace-eyebrow">Scouting</p>
          <h2>New scouting</h2>
          <p className="workspace-copy">
            Start a new run from a single prompt, keep the future campaign controls visible, and
            route the finished list into Database for review.
          </p>
        </div>

        <div className="new-scouting__hero-card">
          <p className="workspace-eyebrow">Current backend mode</p>
          <h3>Scouting + database</h3>
          <p>
            Runs already blend catalog matches with fresh discovery. The visible source mode stays
            locked to that existing server behavior.
          </p>
        </div>
      </section>

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
        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Campaign</span>
            <select disabled value="planned" suppressHydrationWarning>
              <option value="planned">Campaign records land with backend campaign metadata</option>
            </select>
          </label>

          <label className="new-scouting__field">
            <span>Week</span>
            <select disabled value="planned" suppressHydrationWarning>
              <option value="planned">Week planning unlocks after campaign metadata exists</option>
            </select>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Source mode</span>
            <select disabled value="scouting-plus-database" suppressHydrationWarning>
              <option value="scouting-plus-database">Scouting + database</option>
            </select>
          </label>

          <label className="new-scouting__field">
            <span>Brief upload</span>
            <input
              disabled
              placeholder="Brief upload will activate once backend brief handling exists."
              readOnly
              suppressHydrationWarning
              value=""
            />
          </label>
        </div>

        <label className="new-scouting__field">
          <span>Prompt</span>
          <textarea
            disabled={isBusy}
            maxLength={500}
            name="prompt"
            onChange={(event) => onPromptChange(event.currentTarget.value)}
            placeholder="Example: gaming creators with strong strategy content and DACH audience relevance"
            required
            rows={7}
            suppressHydrationWarning
            value={draft.prompt}
          />
          <small>Submitted as the current run query. The run name is auto-generated client-side.</small>
        </label>

        <div className="new-scouting__grid new-scouting__grid--two">
          <label className="new-scouting__field">
            <span>Creators needed</span>
            <input disabled readOnly suppressHydrationWarning value="Planned" />
          </label>

          <label className="new-scouting__field">
            <span>Platform</span>
            <select disabled value="planned" suppressHydrationWarning>
              <option value="planned">Platform targeting follows future backend support</option>
            </select>
          </label>
        </div>

        <div className="new-scouting__grid new-scouting__grid--three">
          <label className="new-scouting__field">
            <span>Min followers</span>
            <input disabled readOnly suppressHydrationWarning value="Planned" />
          </label>

          <label className="new-scouting__field">
            <span>Min avg views</span>
            <input disabled readOnly suppressHydrationWarning value="Planned" />
          </label>

          <label className="new-scouting__field">
            <span>Coverage filters</span>
            <input disabled readOnly suppressHydrationWarning value="Planned" />
          </label>
        </div>

        <p
          className={`new-scouting__status new-scouting__status--${requestState.status}`}
          role={requestState.status === "error" ? "alert" : "status"}
        >
          {requestState.message}
        </p>

        <div className="new-scouting__actions">
          <button disabled={isBusy} suppressHydrationWarning type="submit">
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

  function handlePromptChange(value: string) {
    if (requestState.status === "error") {
      setRequestState(IDLE_REQUEST_STATE);
    }

    setDraft({
      prompt: value,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState(SUBMITTING_REQUEST_STATE);

    try {
      const query = normalizePrompt(draft.prompt);

      if (!query) {
        throw new Error("Prompt is required.");
      }

      const response = await createRun({
        name: buildGeneratedRunName(query),
        query,
      });

      startTransition(() => {
        router.push(`/database?tab=runs&runId=${encodeURIComponent(response.runId)}`);
      });
    } catch (error) {
      setRequestState({
        status: "error",
        message:
          error instanceof Error && error.message === "Prompt is required."
            ? error.message
            : getCreateRunErrorMessage(error),
      });
    }
  }

  return (
    <NewScoutingWorkspaceView
      draft={draft}
      onPromptChange={handlePromptChange}
      onSubmit={handleSubmit}
      requestState={requestState}
      showLegacyNotice={showLegacyNotice}
    />
  );
}
