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
      <aside className="auth-shell__sidebar">
        <p className="auth-shell__eyebrow">Internal Workspace</p>
        <p className="auth-shell__brand">{APP_TITLE}</p>
        <AppNavigation role={role} />
        <SignOutForm />
      </aside>
      <main className="auth-shell__content">{children}</main>
    </div>
  );
}
