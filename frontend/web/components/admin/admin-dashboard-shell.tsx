"use client";

import type {
  AdminDashboardResponse,
  AdminUserResponse,
  CsvImportBatchSummary,
} from "@scouting-platform/contracts";
import Link from "next/link";
import React, { useEffect, useState, type ReactElement } from "react";

import { useDocumentVisibility } from "../../lib/document-visibility";
import {
  AdminDashboardApiError,
  fetchAdminDashboard,
} from "../../lib/admin-dashboard-api";

type AdminDashboardState = {
  status: "loading" | "error" | "ready";
  data: AdminDashboardResponse | null;
  error: string | null;
};

type AdminDashboardShellViewProps = Readonly<{
  dashboardState: AdminDashboardState;
  isRefreshing: boolean;
  onReload: () => void;
  onRetry: () => void;
}>;

type AdminDashboardShortcut = Readonly<{
  label: string;
  title: string;
  href: string;
  copy: string;
}>;

const INITIAL_DASHBOARD_STATE: AdminDashboardState = {
  status: "loading",
  data: null,
  error: null,
};

const ADMIN_DASHBOARD_SHORTCUTS: readonly AdminDashboardShortcut[] = [
  {
    label: "Admin",
    title: "CSV imports",
    href: "/admin/imports",
    copy: "Open Creator List import history, inspect row-level outcomes, and keep long-running batches in view.",
  },
  {
    label: "Admin",
    title: "User setup",
    href: "/admin/users",
    copy: "Create accounts, reset passwords, and assign YouTube API keys before managers start new runs.",
  },
] as const;

export const ADMIN_DASHBOARD_POLL_INTERVAL_MS = 3000;

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function formatTimestamp(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function getDashboardErrorMessage(error: unknown): string {
  if (error instanceof AdminDashboardApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow admin dashboard review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load the admin dashboard. Please try again.");
}

function getPersonLabel(person: { name: string | null; email: string }): string {
  return person.name?.trim() || person.email;
}

function getImportSnippet(batch: CsvImportBatchSummary): string {
  if (batch.lastError) {
    return `Last error: ${batch.lastError}`;
  }

  return `${batch.importedRowCount} imported · ${batch.failedRowCount} failed · ${batch.totalRowCount} total`;
}

function getUserSnippet(user: AdminUserResponse): string {
  return `Created ${formatTimestamp(user.createdAt)} · Missing YouTube API key`;
}

function getActionableImportCount(dashboard: AdminDashboardResponse): number {
  return (
    dashboard.imports.counts.queued +
    dashboard.imports.counts.running +
    dashboard.imports.counts.failed
  );
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function shouldPollAdminDashboard(dashboard: AdminDashboardResponse | null): boolean {
  if (!dashboard) {
    return false;
  }

  return (
    dashboard.imports.counts.queued > 0 ||
    dashboard.imports.counts.running > 0
  );
}

function renderReadyState(dashboard: AdminDashboardResponse): ReactElement {
  const actionableImportCount = getActionableImportCount(dashboard);

  return (
    <div className="admin-dashboard__content">
      <div className="admin-dashboard__card-grid">
        <article className="admin-dashboard__card">
          <p className="admin-dashboard__card-label">CSV imports needing attention</p>
          <p className="admin-dashboard__card-value">{actionableImportCount}</p>
          <p className="admin-dashboard__card-copy">
            Queued {dashboard.imports.counts.queued}, running {dashboard.imports.counts.running},
            failed {dashboard.imports.counts.failed}.
          </p>
        </article>
        <article className="admin-dashboard__card">
          <p className="admin-dashboard__card-label">Managers blocked on YouTube keys</p>
          <p className="admin-dashboard__card-value">{dashboard.users.missingYoutubeKeyCount}</p>
          <p className="admin-dashboard__card-copy">
            {pluralize(dashboard.users.activeCount, "active account")},{" "}
            {pluralize(dashboard.users.adminCount, "admin")},{" "}
            {pluralize(dashboard.users.totalCount, "total record")}.
          </p>
        </article>
      </div>

      <div className="admin-dashboard__panel-grid">
        <section className="admin-dashboard__panel" aria-labelledby="admin-dashboard-imports-heading">
          <header className="admin-dashboard__panel-header">
            <div>
              <p className="admin-dashboard__eyebrow">Attention</p>
              <h3 id="admin-dashboard-imports-heading">CSV imports needing attention</h3>
            </div>
            <Link className="admin-dashboard__link" href="/admin/imports">
              Open imports
            </Link>
          </header>
          {dashboard.imports.attentionPreview.length === 0 ? (
            <p className="admin-dashboard__empty-copy">No queued, running, or failed imports right now.</p>
          ) : (
            <ul className="admin-dashboard__list">
              {dashboard.imports.attentionPreview.map((batch) => (
                <li className="admin-dashboard__list-item" key={batch.id}>
                  <div className="admin-dashboard__list-item-header">
                    <div>
                      <h4>{batch.fileName}</h4>
                      <p className="admin-dashboard__list-meta">
                        Requested by {getPersonLabel(batch.requestedBy)}
                      </p>
                    </div>
                    <span className={`admin-dashboard__status admin-dashboard__status--${batch.status}`}>
                      {batch.status}
                    </span>
                  </div>
                  <p className="admin-dashboard__list-copy">{getImportSnippet(batch)}</p>
                  <p className="admin-dashboard__list-copy">
                    Updated {formatTimestamp(batch.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-dashboard__panel" aria-labelledby="admin-dashboard-users-heading">
          <header className="admin-dashboard__panel-header">
            <div>
              <p className="admin-dashboard__eyebrow">Readiness</p>
              <h3 id="admin-dashboard-users-heading">Managers missing YouTube keys</h3>
            </div>
            <Link className="admin-dashboard__link" href="/admin/users">
              Open users
            </Link>
          </header>
          {dashboard.users.missingYoutubeKeyPreview.length === 0 ? (
            <p className="admin-dashboard__empty-copy">Every active manager currently has a YouTube key assigned.</p>
          ) : (
            <ul className="admin-dashboard__list">
              {dashboard.users.missingYoutubeKeyPreview.map((user) => (
                <li className="admin-dashboard__list-item" key={user.id}>
                  <div className="admin-dashboard__list-item-header">
                    <div>
                      <h4>{getPersonLabel(user)}</h4>
                      <p className="admin-dashboard__list-meta">{user.email}</p>
                    </div>
                    <span className="admin-dashboard__status admin-dashboard__status--missing">
                      Missing key
                    </span>
                  </div>
                  <p className="admin-dashboard__list-copy">{getUserSnippet(user)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="admin-dashboard__timestamp">Last updated {formatTimestamp(dashboard.generatedAt)}</p>
    </div>
  );
}

function renderWorkspaceShortcuts(): ReactElement {
  return (
    <section className="admin-dashboard__section" aria-labelledby="admin-dashboard-shortcuts-heading">
      <header className="admin-dashboard__panel-header">
        <div>
          <p className="admin-dashboard__eyebrow">Workspaces</p>
          <h3 id="admin-dashboard-shortcuts-heading">Jump straight into the right workflow</h3>
          <p className="admin-dashboard__section-copy">
            Open focused admin workspaces for import review and user setup.
          </p>
        </div>
      </header>

      <div className="admin-dashboard__shortcut-grid">
        {ADMIN_DASHBOARD_SHORTCUTS.map((shortcut) => (
          <Link className="admin-dashboard__shortcut-card" href={shortcut.href} key={shortcut.title}>
            <p className="admin-dashboard__card-label">{shortcut.label}</p>
            <h4 className="admin-dashboard__shortcut-title">{shortcut.title}</h4>
            <p className="admin-dashboard__shortcut-copy">{shortcut.copy}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AdminDashboardShellView(props: AdminDashboardShellViewProps): ReactElement {
  const { dashboardState, isRefreshing, onReload, onRetry } = props;

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__toolbar">
        <div className="admin-dashboard__toolbar-copy">
          <p className="admin-dashboard__eyebrow">Admin workspace</p>
          <h2>Admin operations hub</h2>
          <p className="admin-dashboard__toolbar-summary">
            Monitor CSV import batches and user readiness from the admin workspace.
          </p>
        </div>
        <div className="admin-dashboard__toolbar-actions">
          <Link className="admin-dashboard__link" href="/admin/imports">
            Open imports
          </Link>
          <Link className="admin-dashboard__link" href="/admin/users">
            Open users
          </Link>
          <button
            className="admin-dashboard__button admin-dashboard__button--secondary"
            disabled={dashboardState.status === "loading" || isRefreshing}
            onClick={onReload}
            type="button"
          >
            Refresh overview
          </button>
        </div>
      </div>

      {renderWorkspaceShortcuts()}

      {isRefreshing ? (
        <p className="admin-dashboard__inline-note" role="status">
          Refreshing overview...
        </p>
      ) : null}

      {dashboardState.status === "loading" ? (
        <div className="admin-dashboard__feedback admin-dashboard__feedback--loading">
          <p>Loading admin dashboard...</p>
        </div>
      ) : null}

      {dashboardState.status === "error" ? (
        <div className="admin-dashboard__feedback admin-dashboard__feedback--error" role="alert">
          <p>{dashboardState.error ?? "Unable to load the admin dashboard."}</p>
          <button className="admin-dashboard__button" onClick={onRetry} type="button">
            Retry overview
          </button>
        </div>
      ) : null}

      {dashboardState.status === "ready" && dashboardState.data ? renderReadyState(dashboardState.data) : null}
    </div>
  );
}

export function AdminDashboardShell() {
  const [dashboardState, setDashboardState] = useState<AdminDashboardState>(INITIAL_DASHBOARD_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isDocumentVisible = useDocumentVisibility();

  useEffect(() => {
    const abortController = new AbortController();
    const isManualReload = reloadToken > 0;

    if (isManualReload) {
      setIsRefreshing(true);
    }

    void (async () => {
      try {
        const dashboard = await fetchAdminDashboard(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setDashboardState({
          status: "ready",
          data: dashboard,
          error: null,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDashboardState({
          status: "error",
          data: null,
          error: getDashboardErrorMessage(error),
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshing(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  useEffect(() => {
    if (
      dashboardState.status !== "ready" ||
      !isDocumentVisible ||
      !shouldPollAdminDashboard(dashboardState.data) ||
      isRefreshing
    ) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setReloadToken((value) => value + 1);
    }, ADMIN_DASHBOARD_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [dashboardState, isDocumentVisible, isRefreshing]);

  function handleReload(): void {
    setReloadToken((value) => value + 1);
  }

  function handleRetry(): void {
    setDashboardState(INITIAL_DASHBOARD_STATE);
    setReloadToken((value) => value + 1);
  }

  return (
    <AdminDashboardShellView
      dashboardState={dashboardState}
      isRefreshing={isRefreshing}
      onReload={handleReload}
      onRetry={handleRetry}
    />
  );
}
