import { listUsers } from "@scouting-platform/core";
import { notFound, redirect } from "next/navigation";

import { auth } from "../../../../../auth";
import { UserAccountDetail } from "../../../../../components/admin/user-account-detail";
import { PageSection } from "../../../../../components/layout/page-section";
import {
  canAccessNavigationKey,
  FORBIDDEN_ROUTE,
  getRoleFromSession,
  LOGIN_ROUTE,
} from "../../../../../lib/access-control";

type AdminUserDetailPageProps = Readonly<{
  params: Promise<{ userId: string }>;
}>;

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const session = await auth();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
    return null;
  }

  if (!canAccessNavigationKey("admin", getRoleFromSession(session))) {
    redirect(FORBIDDEN_ROUTE);
    return null;
  }

  const { userId } = await params;
  const users = await listUsers();
  const user = users.find((candidate) => candidate.id === userId);

  if (!user) {
    notFound();
    return null;
  }

  return (
    <PageSection
      title={user.name?.trim() || user.email}
      description={`Manage account identity and YouTube credential assignment for ${user.email}.`}
    >
      <UserAccountDetail user={user} />
    </PageSection>
  );
}
