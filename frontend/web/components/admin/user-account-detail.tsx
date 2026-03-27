"use client";

import type { AdminUserResponse, UserType } from "@scouting-platform/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { updateAdminUserProfile, updateAdminUserYoutubeKey } from "../../lib/admin-users-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

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

function formatUserType(userType: UserType): string {
  switch (userType) {
    case "admin":
      return "Admin";
    case "campaign_lead":
      return "Campaign Lead";
    case "hoc":
      return "HoC";
    default:
      return "Campaign Manager";
  }
}

type UserAccountDetailProps = Readonly<{
  user: AdminUserResponse;
}>;

export function UserAccountDetail({ user }: UserAccountDetailProps) {
  const [name, setName] = useState(user.name ?? "");
  const [userType, setUserType] = useState<UserType>(user.userType);
  const [youtubeKeyAssigned, setYoutubeKeyAssigned] = useState(user.youtubeKeyAssigned);
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState<OperationStatus>(IDLE_OPERATION_STATUS);
  const [updateStatus, setUpdateStatus] = useState<OperationStatus>(IDLE_OPERATION_STATUS);
  const userTypeOptions: SearchableSelectOption[] = [
    { value: "campaign_manager", label: "Campaign Manager" },
    { value: "campaign_lead", label: "Campaign Lead" },
    { value: "hoc", label: "HoC" },
    { value: "admin", label: "Admin" },
  ];

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsUpdatingProfile(true);
    setProfileStatus(IDLE_OPERATION_STATUS);

    try {
      const updatedUser = await updateAdminUserProfile(user.id, {
        name: name.trim() || null,
        userType: user.role === "admin" ? "admin" : userType,
      });

      setName(updatedUser.name ?? "");
      setUserType(updatedUser.userType);
      setProfileStatus({
        type: "success",
        message: "Profile updated.",
      });
    } catch (error) {
      setProfileStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  }

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
          <form className="user-account-detail__form" onSubmit={handleProfileSubmit}>
            <dl className="user-account-detail__identity-list">
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{formatRole(user.role)}</dd>
              </div>
            </dl>

            <label className="admin-users__field">
              <span>Name</span>
              <input
                autoComplete="name"
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                suppressHydrationWarning
                type="text"
                value={name}
              />
            </label>

            <label className="admin-users__field">
              <span>User type</span>
              <SearchableSelect
                ariaLabel="User type"
                disabled={user.role === "admin"}
                onChange={(value) => {
                  setUserType(value as UserType);
                }}
                options={userTypeOptions}
                placeholder="Select user type"
                searchPlaceholder="Search user types..."
                value={user.role === "admin" ? "admin" : userType}
              />
            </label>

            <p className="user-account-detail__helper">
              Current user type: {formatUserType(user.role === "admin" ? "admin" : userType)}.
            </p>

            <button
              className="admin-users__button"
              disabled={isUpdatingProfile}
              suppressHydrationWarning
              type="submit"
            >
              {isUpdatingProfile ? "Saving..." : "Save profile"}
            </button>

            <p
              aria-live="polite"
              className={`admin-users__inline-status admin-users__inline-status--${profileStatus.type}`}
              role={profileStatus.type === "error" ? "alert" : undefined}
            >
              {profileStatus.message}
            </p>
          </form>
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

          <form
            className="user-account-detail__form"
            onSubmit={handleYoutubeKeySubmit}
            suppressHydrationWarning
          >
            <label className="admin-users__field">
              <span>{youtubeKeyAssigned ? "Replace YouTube Data API key" : "YouTube Data API key"}</span>
              <input
                autoComplete="off"
                name="youtubeApiKey"
                onChange={(event) => {
                  setYoutubeApiKey(event.currentTarget.value);
                }}
                required
                suppressHydrationWarning
                type="password"
                value={youtubeApiKey}
              />
            </label>

            <p className="user-account-detail__helper">
              The stored key is never shown here. Saving a new value replaces the existing credential.
            </p>

            <button
              className="admin-users__button"
              disabled={isUpdatingKey}
              suppressHydrationWarning
              type="submit"
            >
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
