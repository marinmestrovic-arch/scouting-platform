"use client";

import type { ChannelDetail, ChannelManualOverrideField } from "@scouting-platform/contracts";
import React, { useEffect, useState } from "react";

import { patchAdminChannelManualOverrides } from "../../lib/admin-channels-api";

type ManualEditDrafts = Record<ChannelManualOverrideField, string>;

type PendingManualEditOperation =
  | {
      field: ChannelManualOverrideField;
      op: "set" | "clear";
    }
  | null;

type ManualEditOperationStatus = {
  type: "idle" | "success" | "error";
  field: ChannelManualOverrideField | null;
  message: string;
};

type AdminChannelManualEditPanelProps = Readonly<{
  channel: ChannelDetail;
  onChannelUpdated: (channel: ChannelDetail) => void;
}>;

type AdminChannelManualEditPanelViewProps = Readonly<{
  drafts: ManualEditDrafts;
  pendingOperation: PendingManualEditOperation;
  operationStatus: ManualEditOperationStatus;
  onDraftChange: (field: ChannelManualOverrideField, value: string) => void;
  onSaveField: (field: ChannelManualOverrideField) => void | Promise<void>;
  onClearField: (field: ChannelManualOverrideField) => void | Promise<void>;
}>;

type ManualEditFieldConfig = Readonly<{
  field: ChannelManualOverrideField;
  label: string;
  description: string;
  placeholder: string;
  input: "text" | "textarea";
}>;

const MANUAL_EDIT_FIELDS: readonly ManualEditFieldConfig[] = [
  {
    field: "title",
    label: "Title",
    description: "Override the resolved channel title used across the catalog.",
    placeholder: "Channel title",
    input: "text",
  },
  {
    field: "handle",
    label: "Handle",
    description: "Set or blank the public handle shown in catalog identity surfaces.",
    placeholder: "@channelhandle",
    input: "text",
  },
  {
    field: "thumbnailUrl",
    label: "Thumbnail URL",
    description: "Override the thumbnail URL if automated imports captured the wrong image.",
    placeholder: "https://example.com/thumbnail.jpg",
    input: "text",
  },
  {
    field: "description",
    label: "Description",
    description: "Add or correct the channel description used by managers during review.",
    placeholder: "Describe the creator, niche, and positioning.",
    input: "textarea",
  },
] as const;

const IDLE_MANUAL_EDIT_STATUS: ManualEditOperationStatus = {
  type: "idle",
  field: null,
  message: "",
};

export function createManualEditDrafts(channel: ChannelDetail): ManualEditDrafts {
  return {
    title: channel.title,
    handle: channel.handle ?? "",
    description: channel.description ?? "",
    thumbnailUrl: channel.thumbnailUrl ?? "",
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to update manual channel edits. Please try again.";
}

function getSuccessMessage(field: ChannelManualOverrideField, op: "set" | "clear"): string {
  const label = MANUAL_EDIT_FIELDS.find((candidate) => candidate.field === field)?.label ?? field;

  if (op === "clear") {
    return `${label} reverted to the fallback value.`;
  }

  return `${label} manual override saved.`;
}

function toManualOverrideValue(field: ChannelManualOverrideField, value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    if (field === "title") {
      throw new Error("Title is required.");
    }

    return null;
  }

  return trimmed;
}

function getFieldStatus(
  operationStatus: ManualEditOperationStatus,
  field: ChannelManualOverrideField,
): ManualEditOperationStatus | null {
  if (operationStatus.field !== field || !operationStatus.message) {
    return null;
  }

  return operationStatus;
}

export function AdminChannelManualEditPanelView({
  drafts,
  pendingOperation,
  operationStatus,
  onDraftChange,
  onSaveField,
  onClearField,
}: AdminChannelManualEditPanelViewProps) {
  const isBusy = pendingOperation !== null;

  return (
    <section
      aria-labelledby="channel-detail-shell-manual-edit-heading"
      className="channel-detail-shell__panel"
    >
      <header>
        <h2 id="channel-detail-shell-manual-edit-heading">Admin manual edits</h2>
        <p>
          Save per-field overrides when catalog values need correction. Restoring fallback removes
          the manual override and returns the resolved field to automated data.
        </p>
      </header>

      <p className="channel-detail-shell__manual-edit-note">
        Leaving Handle, Thumbnail URL, or Description blank and saving stores an intentional empty
        manual value.
      </p>

      <div className="channel-detail-shell__manual-edit-list">
        {MANUAL_EDIT_FIELDS.map((fieldConfig) => {
          const fieldStatus = getFieldStatus(operationStatus, fieldConfig.field);
          const isSavePending =
            pendingOperation?.field === fieldConfig.field && pendingOperation.op === "set";
          const isClearPending =
            pendingOperation?.field === fieldConfig.field && pendingOperation.op === "clear";

          return (
            <article className="channel-detail-shell__manual-edit-card" key={fieldConfig.field}>
              <div className="channel-detail-shell__manual-edit-copy">
                <h3 className="channel-detail-shell__subheading">{fieldConfig.label}</h3>
                <p>{fieldConfig.description}</p>
              </div>

              <label className="channel-detail-shell__manual-edit-field">
                <span>{fieldConfig.label}</span>
                {fieldConfig.input === "textarea" ? (
                  <textarea
                    disabled={isBusy}
                    onChange={(event) => {
                      onDraftChange(fieldConfig.field, event.currentTarget.value);
                    }}
                    placeholder={fieldConfig.placeholder}
                    rows={5}
                    value={drafts[fieldConfig.field]}
                  />
                ) : (
                  <input
                    disabled={isBusy}
                    onChange={(event) => {
                      onDraftChange(fieldConfig.field, event.currentTarget.value);
                    }}
                    placeholder={fieldConfig.placeholder}
                    type="text"
                    value={drafts[fieldConfig.field]}
                  />
                )}
              </label>

              <div className="channel-detail-shell__manual-edit-actions">
                <button
                  className="channel-detail-shell__button"
                  disabled={isBusy}
                  onClick={() => {
                    void onSaveField(fieldConfig.field);
                  }}
                  type="button"
                >
                  {isSavePending ? "Saving..." : "Save override"}
                </button>
                <button
                  className="channel-detail-shell__button channel-detail-shell__button--secondary"
                  disabled={isBusy}
                  onClick={() => {
                    void onClearField(fieldConfig.field);
                  }}
                  type="button"
                >
                  {isClearPending ? "Restoring..." : "Restore fallback"}
                </button>
              </div>

              {fieldStatus ? (
                <p
                  className={`channel-detail-shell__manual-edit-status channel-detail-shell__manual-edit-status--${fieldStatus.type}`}
                  role={fieldStatus.type === "error" ? "alert" : undefined}
                >
                  {fieldStatus.message}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AdminChannelManualEditPanel({
  channel,
  onChannelUpdated,
}: AdminChannelManualEditPanelProps) {
  const [drafts, setDrafts] = useState<ManualEditDrafts>(() => createManualEditDrafts(channel));
  const [pendingOperation, setPendingOperation] = useState<PendingManualEditOperation>(null);
  const [operationStatus, setOperationStatus] =
    useState<ManualEditOperationStatus>(IDLE_MANUAL_EDIT_STATUS);

  useEffect(() => {
    setDrafts(createManualEditDrafts(channel));
  }, [channel.description, channel.handle, channel.thumbnailUrl, channel.title]);

  function handleDraftChange(field: ChannelManualOverrideField, value: string): void {
    setDrafts((current) => ({
      ...current,
      [field]: value,
    }));

    setOperationStatus((current) => {
      if (current.field !== field) {
        return current;
      }

      return IDLE_MANUAL_EDIT_STATUS;
    });
  }

  async function handleSaveField(field: ChannelManualOverrideField): Promise<void> {
    setPendingOperation({
      field,
      op: "set",
    });
    setOperationStatus(IDLE_MANUAL_EDIT_STATUS);

    try {
      const value = toManualOverrideValue(field, drafts[field]);
      const response = await patchAdminChannelManualOverrides(channel.id, {
        operations: [
          {
            field,
            op: "set",
            value,
          },
        ],
      });

      setDrafts(createManualEditDrafts(response.channel));
      onChannelUpdated(response.channel);
      setOperationStatus({
        type: "success",
        field,
        message: getSuccessMessage(field, "set"),
      });
    } catch (error) {
      setOperationStatus({
        type: "error",
        field,
        message: getErrorMessage(error),
      });
    } finally {
      setPendingOperation(null);
    }
  }

  async function handleClearField(field: ChannelManualOverrideField): Promise<void> {
    setPendingOperation({
      field,
      op: "clear",
    });
    setOperationStatus(IDLE_MANUAL_EDIT_STATUS);

    try {
      const response = await patchAdminChannelManualOverrides(channel.id, {
        operations: [
          {
            field,
            op: "clear",
          },
        ],
      });

      setDrafts(createManualEditDrafts(response.channel));
      onChannelUpdated(response.channel);
      setOperationStatus({
        type: "success",
        field,
        message: getSuccessMessage(field, "clear"),
      });
    } catch (error) {
      setOperationStatus({
        type: "error",
        field,
        message: getErrorMessage(error),
      });
    } finally {
      setPendingOperation(null);
    }
  }

  return (
    <AdminChannelManualEditPanelView
      drafts={drafts}
      onClearField={handleClearField}
      onDraftChange={handleDraftChange}
      onSaveField={handleSaveField}
      operationStatus={operationStatus}
      pendingOperation={pendingOperation}
    />
  );
}
