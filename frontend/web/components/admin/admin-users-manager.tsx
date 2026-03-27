"use client";

import type { AdminUserResponse, Role, UserType } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";

import { createAdminUser, fetchAdminUsers } from "../../lib/admin-users-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type CreateUserFormState = {
  email: string;
  name: string;
  role: Role;
  userType: UserType;
  password: string;
};

type OperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

type AdminUsersManagerViewProps = Readonly<{
  users: AdminUserResponse[];
  isLoadingUsers: boolean;
  usersError: string | null;
  createUserForm: CreateUserFormState;
  isCreateOpen: boolean;
  isCreatingUser: boolean;
  createUserStatus: OperationStatus;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onRetryUsers: () => void;
  onCreateUserFormChange: <Field extends keyof CreateUserFormState>(
    field: Field,
    value: CreateUserFormState[Field],
  ) => void;
  onCreateUserSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onSelectUser: (userId: string) => void;
}>;

const INITIAL_CREATE_USER_FORM_STATE: CreateUserFormState = {
  email: "",
  name: "",
  role: "user",
  userType: "campaign_manager",
  password: "",
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

function formatUserTypeLabel(userType: UserType): string {
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

function formatRoleLabel(role: Role): string {
  return role === "admin" ? "Admin" : "User";
}

function formatTimestamp(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function getStatusLabel(isActive: boolean): string {
  return isActive ? "Active" : "Inactive";
}

function getYoutubeKeyLabel(user: AdminUserResponse): string {
  return user.youtubeKeyAssigned ? "Assigned" : "Missing";
}

function renderUsersTable(props: AdminUsersManagerViewProps): ReactElement {
  const { users, onSelectUser } = props;

  return (
    <div className="admin-users__table-shell">
      <table className="admin-users__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>User type</th>
            <th>Status</th>
            <th>YouTube key</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              className="admin-users__table-row"
              key={user.id}
              onClick={() => {
                onSelectUser(user.id);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectUser(user.id);
                }
              }}
              role="link"
              tabIndex={0}
            >
              <td className="admin-users__primary-cell">
                <Link
                  className="admin-users__table-link"
                  href={`/admin/users/${user.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {user.name?.trim() || "Unnamed user"}
                </Link>
              </td>
              <td className="admin-users__muted-cell">{user.email}</td>
              <td>{formatRoleLabel(user.role)}</td>
              <td>{formatUserTypeLabel(user.userType)}</td>
              <td>
                <span
                  className={`admin-users__status admin-users__status--${user.isActive ? "active" : "inactive"}`}
                >
                  {getStatusLabel(user.isActive)}
                </span>
              </td>
              <td>
                <span
                  className={`admin-users__status admin-users__status--${user.youtubeKeyAssigned ? "assigned" : "missing"}`}
                >
                  {getYoutubeKeyLabel(user)}
                </span>
              </td>
              <td className="admin-users__muted-cell">{formatTimestamp(user.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderUsersContent(props: AdminUsersManagerViewProps): ReactElement {
  const { isLoadingUsers, usersError, users, onRetryUsers } = props;

  if (isLoadingUsers) {
    return <p className="admin-users__feedback admin-users__feedback--loading">Loading users...</p>;
  }

  if (usersError) {
    return (
      <div className="admin-users__feedback admin-users__feedback--error" role="alert">
        <p>{usersError}</p>
        <button
          className="admin-users__button admin-users__button--secondary"
          onClick={onRetryUsers}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  if (users.length === 0) {
    return <p className="admin-users__feedback admin-users__feedback--empty">No users found.</p>;
  }

  return renderUsersTable(props);
}

function renderCreateModal(props: AdminUsersManagerViewProps): ReactElement | null {
  const {
    createUserForm,
    createUserStatus,
    isCreateOpen,
    isCreatingUser,
    onCloseCreate,
    onCreateUserFormChange,
    onCreateUserSubmit,
  } = props;

  if (!isCreateOpen) {
    return null;
  }

  const roleOptions: SearchableSelectOption[] = [
    { value: "user", label: "User" },
    { value: "admin", label: "Admin" },
  ];
  const userTypeOptions: SearchableSelectOption[] = [
    { value: "campaign_manager", label: "Campaign Manager" },
    { value: "campaign_lead", label: "Campaign Lead" },
    { value: "hoc", label: "HoC" },
    { value: "admin", label: "Admin" },
  ];

  return (
    <div className="database-admin__modal-backdrop" onClick={onCloseCreate} role="presentation">
      <div
        aria-labelledby="admin-users-create-title"
        aria-modal="true"
        className="database-admin__modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
        role="dialog"
      >
        <div className="database-admin__modal-header">
          <div>
            <p className="workspace-eyebrow">Admin</p>
            <h3 id="admin-users-create-title">Add user</h3>
          </div>
          <button className="database-admin__modal-close" onClick={onCloseCreate} type="button">
            Close
          </button>
        </div>

        <form className="admin-users__create-form" onSubmit={onCreateUserSubmit} suppressHydrationWarning>
          <div className="admin-users__form-grid">
            <label className="admin-users__field">
              <span>Email</span>
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => {
                  onCreateUserFormChange("email", event.currentTarget.value);
                }}
                required
                suppressHydrationWarning
                type="email"
                value={createUserForm.email}
              />
            </label>
            <label className="admin-users__field">
              <span>Name</span>
              <input
                autoComplete="name"
                name="name"
                onChange={(event) => {
                  onCreateUserFormChange("name", event.currentTarget.value);
                }}
                suppressHydrationWarning
                type="text"
                value={createUserForm.name}
              />
            </label>
            <label className="admin-users__field">
              <span>Role</span>
              <SearchableSelect
                ariaLabel="Role"
                onChange={(value) => {
                  const nextRole = value === "admin" ? "admin" : "user";
                  onCreateUserFormChange("role", nextRole);
                  onCreateUserFormChange("userType", nextRole === "admin" ? "admin" : "campaign_manager");
                }}
                options={roleOptions}
                placeholder="Select role"
                searchPlaceholder="Search roles..."
                value={createUserForm.role}
              />
            </label>
            <label className="admin-users__field">
              <span>User type</span>
              <SearchableSelect
                ariaLabel="User type"
                disabled={createUserForm.role === "admin"}
                onChange={(value) => {
                  onCreateUserFormChange("userType", value as UserType);
                }}
                options={userTypeOptions}
                placeholder="Select user type"
                searchPlaceholder="Search user types..."
                value={createUserForm.userType}
              />
            </label>
            <label className="admin-users__field admin-users__field--full">
              <span>Password</span>
              <input
                autoComplete="new-password"
                minLength={8}
                name="password"
                onChange={(event) => {
                  onCreateUserFormChange("password", event.currentTarget.value);
                }}
                required
                suppressHydrationWarning
                type="password"
                value={createUserForm.password}
              />
            </label>
          </div>

          <div className="admin-users__form-actions">
            <button className="admin-users__button" disabled={isCreatingUser} type="submit">
              {isCreatingUser ? "Creating..." : "Create user"}
            </button>
            <button
              className="admin-users__button admin-users__button--secondary"
              onClick={onCloseCreate}
              type="button"
            >
              Cancel
            </button>
          </div>

          <p
            className={`admin-users__inline-status admin-users__inline-status--${createUserStatus.type}`}
            role={createUserStatus.type === "error" ? "alert" : undefined}
          >
            {createUserStatus.message}
          </p>
        </form>
      </div>
    </div>
  );
}

export function AdminUsersManagerView(props: AdminUsersManagerViewProps): ReactElement {
  return (
    <div className="admin-users">
      <section className="admin-users__panel" aria-labelledby="admin-users-heading">
        <div className="admin-users__header">
          <div>
            <p className="admin-users__eyebrow">Accounts</p>
            <h2 id="admin-users-heading">Users</h2>
            <p className="admin-users__copy">
              Review account readiness in one table, then open a user detail page for passwords and YouTube key assignment.
            </p>
          </div>
          <div className="admin-users__header-actions">
            <button className="admin-users__button admin-users__button--secondary" onClick={props.onRetryUsers} type="button">
              Refresh
            </button>
            <button className="admin-users__button" onClick={props.onOpenCreate} type="button">
              Add User
            </button>
          </div>
        </div>

        {renderUsersContent(props)}
      </section>

      {renderCreateModal(props)}
    </div>
  );
}

export function AdminUsersManager() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(INITIAL_CREATE_USER_FORM_STATE);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserStatus, setCreateUserStatus] = useState<OperationStatus>(IDLE_OPERATION_STATUS);

  async function loadUsers(signal?: AbortSignal): Promise<void> {
    setIsLoadingUsers(true);
    setUsersError(null);

    try {
      const nextUsers = await fetchAdminUsers(signal);
      setUsers(nextUsers);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }

      setUsersError(getErrorMessage(error));
      setUsers([]);
    } finally {
      if (!signal?.aborted) {
        setIsLoadingUsers(false);
      }
    }
  }

  useEffect(() => {
    const abortController = new AbortController();
    void loadUsers(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, []);

  function updateCreateUserFormState<Field extends keyof CreateUserFormState>(
    field: Field,
    value: CreateUserFormState[Field],
  ): void {
    setCreateUserForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleCreateUserSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsCreatingUser(true);
    setCreateUserStatus(IDLE_OPERATION_STATUS);

    try {
      const createdUser = await createAdminUser({
        email: createUserForm.email.trim(),
        name: createUserForm.name.trim() || undefined,
        role: createUserForm.role,
        userType: createUserForm.role === "admin" ? "admin" : createUserForm.userType,
        password: createUserForm.password,
      });

      setUsers((current) => [createdUser, ...current]);
      setCreateUserForm(INITIAL_CREATE_USER_FORM_STATE);
      setCreateUserStatus({
        type: "success",
        message: "User created.",
      });
    } catch (error) {
      setCreateUserStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsCreatingUser(false);
    }
  }

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        const leftValue = left.createdAt;
        const rightValue = right.createdAt;
        return rightValue.localeCompare(leftValue);
      }),
    [users],
  );

  return (
    <AdminUsersManagerView
      createUserForm={createUserForm}
      createUserStatus={createUserStatus}
      isCreateOpen={isCreateOpen}
      isCreatingUser={isCreatingUser}
      isLoadingUsers={isLoadingUsers}
      onCloseCreate={() => {
        setIsCreateOpen(false);
      }}
      onCreateUserFormChange={updateCreateUserFormState}
      onCreateUserSubmit={handleCreateUserSubmit}
      onOpenCreate={() => {
        setIsCreateOpen(true);
        setCreateUserStatus(IDLE_OPERATION_STATUS);
      }}
      onRetryUsers={() => {
        void loadUsers();
      }}
      onSelectUser={(userId) => {
        router.push(`/admin/users/${userId}`);
      }}
      users={sortedUsers}
      usersError={usersError}
    />
  );
}
