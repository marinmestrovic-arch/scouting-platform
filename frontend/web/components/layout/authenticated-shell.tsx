import Image from "next/image";
import Link from "next/link";
import React, { type ReactNode } from "react";
import type { AppRole } from "../../lib/navigation";
import { SignOutForm } from "../auth/sign-out-form";
import { AppNavigation } from "./app-navigation";
import { MobileNavToggle } from "./mobile-nav-toggle";

type AuthenticatedShellProps = Readonly<{
  children: ReactNode;
  role: AppRole;
}>;

export function AuthenticatedShell({ children, role }: AuthenticatedShellProps) {
  return (
    <div className="auth-shell" suppressHydrationWarning>
      <header className="auth-shell__header">
        <div className="auth-shell__header-inner">
          <Link aria-label="ARCH. Atlas" className="auth-shell__brand" href="/dashboard">
            <span className="auth-shell__brand-mark">
              <Image
                alt=""
                className="auth-shell__brand-logo"
                height={18}
                priority
                src="/arch-logo.svg"
                width={68}
              />
            </span>
            <span className="auth-shell__brand-wordmark">Atlas</span>
          </Link>

          <div className="auth-shell__nav-region" id="auth-shell-primary-nav">
            <AppNavigation role={role} />
          </div>

          <div className="auth-shell__actions">
            {role === "admin" ? (
              <span className="auth-shell__role-badge">Admin</span>
            ) : null}
            <SignOutForm />
            <MobileNavToggle />
          </div>
        </div>
      </header>
      <main className="auth-shell__content">{children}</main>
    </div>
  );
}
