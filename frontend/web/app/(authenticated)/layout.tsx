import React, { type ReactNode } from "react";
import { getSession } from "../../lib/cached-auth";
import { AuthenticatedShell } from "../../components/layout/authenticated-shell";
import { getRoleFromSession, LOGIN_ROUTE } from "../../lib/access-control";
import { redirect } from "next/navigation";

type AuthenticatedLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const session = await getSession();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
    return null;
  }

  return <AuthenticatedShell role={getRoleFromSession(session)}>{children}</AuthenticatedShell>;
}
