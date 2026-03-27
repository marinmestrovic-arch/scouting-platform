import Image from "next/image";
import Link from "next/link";
import React, { type ReactNode } from "react";
import type { AppRole } from "../../lib/navigation";
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
        <div className="auth-shell__header-inner">
          <Link className="auth-shell__brand" href="/dashboard">
            <span className="auth-shell__brand-mark">
              <Image
                alt="Arch"
                className="auth-shell__brand-logo"
                height={22}
                priority
                src="/arch-logo.svg"
                width={83}
              />
            </span>
          </Link>

          <AppNavigation role={role} />

          <div className="auth-shell__actions">
            <span className="auth-shell__role-badge">{role === "admin" ? "Admin" : "User"}</span>
            <SignOutForm />
          </div>
        </div>
      </header>
      <main className="auth-shell__content">{children}</main>
    </div>
  );
}
