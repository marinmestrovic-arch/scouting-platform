import React, { type ReactNode } from "react";
import type { AppRole } from "../../lib/navigation";
import { APP_TITLE } from "../../lib/shell";
import { SignOutForm } from "../auth/sign-out-form";
import { AppNavigation } from "./app-navigation";

type AuthenticatedShellProps = Readonly<{
  children: ReactNode;
  role: AppRole;
}>;

export function AuthenticatedShell({ children, role }: AuthenticatedShellProps) {
  return (
    <div className="auth-shell" suppressHydrationWarning>
      <header className="auth-shell__header">
        <div className="auth-shell__masthead">
          <div>
            <p className="auth-shell__eyebrow">Internal Workspace</p>
            <p className="auth-shell__brand">{APP_TITLE}</p>
            <p className="auth-shell__summary">
              Campaign managers review runs, shortlist creators, and hand off delivery actions from
              one place.
            </p>
          </div>

          <div className="auth-shell__actions">
            <span className="auth-shell__role-badge">{role === "admin" ? "Admin" : "User"}</span>
            <SignOutForm />
          </div>
        </div>

        <AppNavigation role={role} />
      </header>
      <main className="auth-shell__content">{children}</main>
    </div>
  );
}
