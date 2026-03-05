import type { ReactNode } from "react";
import { auth } from "../../auth";
import { AuthenticatedShell } from "../../components/layout/authenticated-shell";
import { getRoleFromSession, LOGIN_ROUTE } from "../../lib/access-control";
import { redirect } from "next/navigation";

type AuthenticatedLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const session = await auth();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
    return null;
  }

  return <AuthenticatedShell role={getRoleFromSession(session)}>{children}</AuthenticatedShell>;
}
