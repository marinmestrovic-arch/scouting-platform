"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { startTransition, useState } from "react";

import { ApiRequestError } from "../../lib/runs-api";

type CreateRunShellProps = Readonly<{
  showRunsIndexLink?: boolean;
}>;

type RunDraft = {
  name: string;
  query: string;
  target: string;
};

type CreateRunRequestState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

type CreateRunShellViewProps = CreateRunShellProps & {
  draft: RunDraft;
  requestState: CreateRunRequestState;
  onNameChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
};

const DEFAULT_DRAFT: RunDraft = {
  name: "",
  query: "",
  target: "",
};

const IDLE_REQUEST_STATE: CreateRunRequestState = {
  status: "idle",
  message:
    "Runs blend matching catalog channels with new YouTube discovery using the API key assigned to your account.",
};

const SUBMITTING_REQUEST_STATE: CreateRunRequestState = {
  status: "submitting",
  message: "Opening the Week 7 New Scouting workspace.",
};

export function normalizeRunDraft(draft: RunDraft): RunDraft {
  return {
    name: draft.name.trim(),
    query: draft.query.trim(),
    target: draft.target.trim(),
  };
}

export function normalizeRunTarget(value: string): number | null {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return null;
  }

  return parsedValue;
}

export function getCreateRunErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.message.includes("YouTube API key")) {
      return "Your account does not have an assigned YouTube API key yet. Ask an admin to add one before starting a run.";
    }

    if (error.status === 401 || error.status === 403) {
      return "Your session no longer allows run creation. Sign in again and retry.";
    }

    return error.message;
  }

  if (
    error instanceof Error &&
    (error.message.includes("Run name and search query are required") ||
      error.message.includes("Run name, target, and search query are required"))
  ) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to create run. Please try again.";
}

export function CreateRunShellView({
  draft,
  requestState,
  onNameChange,
  onQueryChange,
  onTargetChange,
  onSubmit,
  showRunsIndexLink = false,
}: CreateRunShellViewProps) {
  const isBusy = requestState.status === "submitting";

  return (
    <div className="run-create">
      <section aria-labelledby="run-create-heading" className="run-create__panel">
        <header className="run-create__header">
          <p className="run-create__eyebrow">Week 3 discovery</p>
          <h2 id="run-create-heading">Start a scouting run</h2>
          <p>
            This legacy shell now forwards to the Week 7 New Scouting workspace, where campaign
            metadata, Dashboard filters, and HubSpot import readiness are stored together.
          </p>
        </header>

        <dl className="run-create__highlights">
          <div>
            <dt>Input</dt>
            <dd>Use New Scouting for the full Week 7 metadata set.</dd>
          </div>
          <div>
            <dt>Primary route</dt>
            <dd>The live run form now lives at /new-scouting.</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>Dashboard-ready runs plus HubSpot import-ready metadata.</dd>
          </div>
        </dl>
      </section>

      <form
        className="run-create__panel run-create__form"
        onSubmit={onSubmit}
        suppressHydrationWarning
      >
        <label className="run-create__field">
          <span>Run name</span>
          <input
            autoComplete="off"
            disabled={isBusy}
            maxLength={200}
            name="name"
            onChange={(event) => onNameChange(event.currentTarget.value)}
            placeholder="Spring gaming outreach"
            required
            suppressHydrationWarning
            value={draft.name}
          />
        </label>

        <label className="run-create__field">
          <span>Search query</span>
          <textarea
            disabled={isBusy}
            maxLength={500}
            name="query"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="gaming creators with strategy and RPG coverage"
            required
            rows={5}
            suppressHydrationWarning
            value={draft.query}
          />
        </label>

        <label className="run-create__field">
          <span>Target</span>
          <input
            disabled={isBusy}
            inputMode="numeric"
            min={1}
            name="target"
            onChange={(event) => onTargetChange(event.currentTarget.value)}
            placeholder="25"
            required
            step={1}
            suppressHydrationWarning
            type="number"
            value={draft.target}
          />
        </label>

        <p
          className={`run-create__status run-create__status--${requestState.status}`}
          role={requestState.status === "error" ? "alert" : "status"}
        >
          {requestState.message}
        </p>

        <div className="run-create__actions">
          <button
            className="run-create__submit"
            disabled={isBusy}
            suppressHydrationWarning
            type="submit"
          >
            {isBusy ? "Creating run..." : "Create run"}
          </button>

          {showRunsIndexLink ? (
            <Link className="run-create__secondary-link" href="/runs">
              Back to runs
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export function CreateRunShell({ showRunsIndexLink = false }: CreateRunShellProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<RunDraft>(DEFAULT_DRAFT);
  const [requestState, setRequestState] = useState<CreateRunRequestState>(IDLE_REQUEST_STATE);

  function resetRequestStateIfNeeded() {
    if (requestState.status === "error") {
      setRequestState(IDLE_REQUEST_STATE);
    }
  }

  function handleNameChange(value: string) {
    resetRequestStateIfNeeded();
    setDraft((current) => ({
      ...current,
      name: value,
    }));
  }

  function handleQueryChange(value: string) {
    resetRequestStateIfNeeded();
    setDraft((current) => ({
      ...current,
      query: value,
    }));
  }

  function handleTargetChange(value: string) {
    resetRequestStateIfNeeded();
    setDraft((current) => ({
      ...current,
      target: value,
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState(SUBMITTING_REQUEST_STATE);

    try {
      const normalizedDraft = normalizeRunDraft({
        name: draft.name,
        query: draft.query,
        target: draft.target,
      });
      const normalizedTarget = normalizeRunTarget(draft.target);

      if (!normalizedDraft.name || !normalizedDraft.query || normalizedTarget === null) {
        throw new Error("Run name, target, and search query are required.");
      }

      startTransition(() => {
        router.push("/new-scouting");
      });
    } catch (error) {
      setRequestState({
        status: "error",
        message: getCreateRunErrorMessage(error),
      });
    }
  }

  return (
    <CreateRunShellView
      draft={draft}
      onNameChange={handleNameChange}
      onQueryChange={handleQueryChange}
      onTargetChange={handleTargetChange}
      onSubmit={handleSubmit}
      requestState={requestState}
      showRunsIndexLink={showRunsIndexLink}
    />
  );
}
