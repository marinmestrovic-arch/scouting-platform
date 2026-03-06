"use client";

import type { AdminUserResponse, Role } from "@scouting-platform/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { createAdminUser, fetchAdminUsers, updateAdminUserPassword } from "../../lib/admin-users-api";

type CreateUserFormState = {
  email: string;
  name: string;
  role: Role;
  password: string;
};

type OperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

const INITIAL_CREATE_USER_FORM_STATE: CreateUserFormState = {
  email: "",
  name: "",
  role: "user",
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

function formatUserMeta(user: AdminUserResponse): string {
  const roleLabel = user.role === "admin" ? "Admin" : "User";
  const youtubeKeyLabel = user.youtubeKeyAssigned ? "Assigned" : "Missing";

  return `${roleLabel} · YouTube key: ${youtubeKeyLabel}`;
}

export function AdminUsersManager() {
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(INITIAL_CREATE_USER_FORM_STATE);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserStatus, setCreateUserStatus] = useState<OperationStatus>(IDLE_OPERATION_STATUS);

  const [passwordDraftByUserId, setPasswordDraftByUserId] = useState<Record<string, string>>({});
  const [passwordStatusByUserId, setPasswordStatusByUserId] = useState<Record<string, OperationStatus>>({});
  const [pendingPasswordUserId, setPendingPasswordUserId] = useState<string | null>(null);

  const hasUsers = users.length > 0;

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
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
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    void loadUsers(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [loadUsers]);

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
        password: createUserForm.password,
      });

      setUsers((current) => [...current, createdUser]);
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

  function handlePasswordInputChange(userId: string, value: string): void {
    setPasswordDraftByUserId((current) => ({
      ...current,
      [userId]: value,
    }));
  }

  async function handleUpdatePasswordSubmit(
    event: FormEvent<HTMLFormElement>,
    userId: string,
  ): Promise<void> {
    event.preventDefault();

    const password = passwordDraftByUserId[userId] ?? "";

    if (!password) {
      setPasswordStatusByUserId((current) => ({
        ...current,
        [userId]: {
          type: "error",
          message: "Password is required.",
        },
      }));
      return;
    }

    setPendingPasswordUserId(userId);
    setPasswordStatusByUserId((current) => ({
      ...current,
      [userId]: IDLE_OPERATION_STATUS,
    }));

    try {
      const updatedUser = await updateAdminUserPassword(userId, { password });

      setUsers((current) => current.map((user) => (user.id === userId ? updatedUser : user)));
      setPasswordDraftByUserId((current) => ({
        ...current,
        [userId]: "",
      }));
      setPasswordStatusByUserId((current) => ({
        ...current,
        [userId]: {
          type: "success",
          message: "Password updated.",
        },
      }));
    } catch (error) {
      setPasswordStatusByUserId((current) => ({
        ...current,
        [userId]: {
          type: "error",
          message: getErrorMessage(error),
        },
      }));
    } finally {
      setPendingPasswordUserId(null);
    }
  }

  const usersContent = useMemo(() => {
    if (isLoadingUsers) {
      return <p className="admin-users__feedback admin-users__feedback--loading">Loading users...</p>;
    }

    if (usersError) {
      return (
        <div className="admin-users__feedback admin-users__feedback--error" role="alert">
          <p>{usersError}</p>
          <button
            className="admin-users__button admin-users__button--secondary"
            onClick={() => {
              void loadUsers();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      );
    }

    if (!hasUsers) {
      return <p className="admin-users__feedback admin-users__feedback--empty">No users found.</p>;
    }

    return (
      <ul className="admin-users__list">
        {users.map((user) => {
          const passwordStatus = passwordStatusByUserId[user.id] ?? IDLE_OPERATION_STATUS;
          const isPasswordPending = pendingPasswordUserId === user.id;

          return (
            <li className="admin-users__item" key={user.id}>
              <div className="admin-users__item-header">
                <h3>{user.name?.trim() || "Unnamed user"}</h3>
                <p>{user.email}</p>
                <p className="admin-users__meta">{formatUserMeta(user)}</p>
              </div>
              <form
                className="admin-users__password-form"
                onSubmit={(event) => {
                  void handleUpdatePasswordSubmit(event, user.id);
                }}
              >
                <label className="admin-users__field">
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    name={`password-${user.id}`}
                    onChange={(event) => {
                      handlePasswordInputChange(user.id, event.currentTarget.value);
                    }}
                    required
                    type="password"
                    value={passwordDraftByUserId[user.id] ?? ""}
                  />
                </label>
                <button
                  className="admin-users__button"
                  disabled={isPasswordPending}
                  type="submit"
                >
                  {isPasswordPending ? "Updating..." : "Update password"}
                </button>
                <p
                  className={`admin-users__inline-status admin-users__inline-status--${passwordStatus.type}`}
                  role={passwordStatus.type === "error" ? "alert" : undefined}
                >
                  {passwordStatus.message}
                </p>
              </form>
            </li>
          );
        })}
      </ul>
    );
  }, [hasUsers, isLoadingUsers, loadUsers, passwordDraftByUserId, passwordStatusByUserId, pendingPasswordUserId, users, usersError]);

  return (
    <div className="admin-users">
      <section className="admin-users__panel" aria-labelledby="admin-users-create-heading">
        <header>
          <h2 id="admin-users-create-heading">Create user</h2>
        </header>
        <form className="admin-users__create-form" onSubmit={(event) => void handleCreateUserSubmit(event)}>
          <label className="admin-users__field">
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => {
                updateCreateUserFormState("email", event.currentTarget.value);
              }}
              required
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
                updateCreateUserFormState("name", event.currentTarget.value);
              }}
              type="text"
              value={createUserForm.name}
            />
          </label>
          <label className="admin-users__field">
            <span>Role</span>
            <select
              name="role"
              onChange={(event) => {
                updateCreateUserFormState(
                  "role",
                  event.currentTarget.value === "admin" ? "admin" : "user",
                );
              }}
              value={createUserForm.role}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="admin-users__field">
            <span>Password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              onChange={(event) => {
                updateCreateUserFormState("password", event.currentTarget.value);
              }}
              required
              type="password"
              value={createUserForm.password}
            />
          </label>
          <button
            className="admin-users__button"
            disabled={isCreatingUser}
            type="submit"
          >
            {isCreatingUser ? "Creating..." : "Create user"}
          </button>
          <p
            className={`admin-users__inline-status admin-users__inline-status--${createUserStatus.type}`}
            role={createUserStatus.type === "error" ? "alert" : undefined}
          >
            {createUserStatus.message}
          </p>
        </form>
      </section>

      <section className="admin-users__panel" aria-labelledby="admin-users-list-heading">
        <header className="admin-users__list-header">
          <h2 id="admin-users-list-heading">Users</h2>
          <button
            className="admin-users__button admin-users__button--secondary"
            onClick={() => {
              void loadUsers();
            }}
            type="button"
          >
            Refresh
          </button>
        </header>
        {usersContent}
      </section>
    </div>
  );
}
