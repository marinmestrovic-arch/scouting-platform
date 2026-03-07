"use client";

import type { AdminUserResponse } from "@scouting-platform/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { updateAdminUserYoutubeKey } from "../../lib/admin-users-api";

type OperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

const IDLE_OPERATION_STATUS: OperationStatus = {
  type: "idle",
  message: "",
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to complete the request. Please try again.";
}

function formatRole(role: AdminUserResponse["role"]): string {
  return role === "admin" ? "Admin" : "User";
}

type UserAccountDetailProps = Readonly<{
  user: AdminUserResponse;
}>;

export function UserAccountDetail({ user }: UserAccountDetailProps) {
  const [youtubeKeyAssigned, setYoutubeKeyAssigned] = useState(user.youtubeKeyAssigned);
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<OperationStatus>(IDLE_OPERATION_STATUS);

  async function handleYoutubeKeySubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextYoutubeApiKey = youtubeApiKey.trim();

    if (!nextYoutubeApiKey) {
      setUpdateStatus({
        type: "error",
        message: "YouTube API key is required.",
      });
      return;
    }

    const hadAssignedKey = youtubeKeyAssigned;

    setIsUpdatingKey(true);
    setUpdateStatus(IDLE_OPERATION_STATUS);

    try {
      await updateAdminUserYoutubeKey(user.id, {
        youtubeApiKey: nextYoutubeApiKey,
      });

      setYoutubeKeyAssigned(true);
      setYoutubeApiKey("");
      setUpdateStatus({
        type: "success",
        message: hadAssignedKey ? "YouTube API key updated." : "YouTube API key assigned.",
      });
    } catch (error) {
      setUpdateStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsUpdatingKey(false);
    }
  }

  return (
    <div className="user-account-detail">
      <Link className="user-account-detail__back-link" href="/admin/users">
        Back to user management
      </Link>

      <div className="user-account-detail__grid">
        <section
          aria-labelledby="user-account-detail-identity-heading"
          className="admin-users__panel user-account-detail__panel"
        >
          <header>
            <h2 id="user-account-detail-identity-heading">Account identity</h2>
          </header>
          <dl className="user-account-detail__identity-list">
            <div>
              <dt>Name</dt>
              <dd>{user.name?.trim() || "Unnamed user"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{formatRole(user.role)}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="user-account-detail-youtube-heading"
          className="admin-users__panel user-account-detail__panel"
        >
          <header>
            <h2 id="user-account-detail-youtube-heading">YouTube Data API key</h2>
          </header>

          <div className="user-account-detail__credential-state">
            <span
              className={`user-account-detail__status-badge user-account-detail__status-badge--${
                youtubeKeyAssigned ? "assigned" : "missing"
              }`}
            >
              {youtubeKeyAssigned ? "Assigned" : "Missing"}
            </span>
            <p className="user-account-detail__credential-copy">
              {youtubeKeyAssigned
                ? "A credential is already stored for this user. Enter a new value below to replace it."
                : "No credential is stored for this user yet. Assign one below to enable YouTube-backed runs."}
            </p>
          </div>

          <form className="user-account-detail__form" onSubmit={handleYoutubeKeySubmit}>
            <label className="admin-users__field">
              <span>{youtubeKeyAssigned ? "Replace YouTube Data API key" : "YouTube Data API key"}</span>
              <input
                autoComplete="off"
                name="youtubeApiKey"
                onChange={(event) => {
                  setYoutubeApiKey(event.currentTarget.value);
                }}
                required
                type="password"
                value={youtubeApiKey}
              />
            </label>

            <p className="user-account-detail__helper">
              The stored key is never shown here. Saving a new value replaces the existing credential.
            </p>

            <button className="admin-users__button" disabled={isUpdatingKey} type="submit">
              {isUpdatingKey
                ? youtubeKeyAssigned
                  ? "Updating..."
                  : "Assigning..."
                : youtubeKeyAssigned
                  ? "Update YouTube API key"
                  : "Assign YouTube API key"}
            </button>

            <p
              aria-live="polite"
              className={`admin-users__inline-status admin-users__inline-status--${updateStatus.type}`}
              role={updateStatus.type === "error" ? "alert" : undefined}
            >
              {updateStatus.message}
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
