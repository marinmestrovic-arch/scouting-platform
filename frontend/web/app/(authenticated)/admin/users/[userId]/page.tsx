import React, { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { getSession } from "../../../../../lib/cached-auth";
import { getCachedUsers } from "../../../../../lib/cached-data";
import { UserAccountDetail } from "../../../../../components/admin/user-account-detail";
import { PageSection } from "../../../../../components/layout/page-section";
import { Skeleton, SkeletonPageBody } from "../../../../../components/ui/skeleton";
import {
  canAccessNavigationKey,
  FORBIDDEN_ROUTE,
  getRoleFromSession,
  LOGIN_ROUTE,
} from "../../../../../lib/access-control";

type AdminUserDetailPageProps = Readonly<{
  params: Promise<{ userId: string }>;
}>;

async function UserDetailData({ userId }: { userId: string }) {
  const session = await getSession();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
    return null;
  }

  if (!canAccessNavigationKey("admin", getRoleFromSession(session))) {
    redirect(FORBIDDEN_ROUTE);
    return null;
  }

  const users = await getCachedUsers();
  const user = users.find((candidate) => candidate.id === userId);

  if (!user) {
    notFound();
    return null;
  }

  return (
    <PageSection
      section="Admin"
      title={user.name?.trim() || user.email}
      description={`Manage account identity and YouTube credential assignment for ${user.email}.`}
    >
      <UserAccountDetail user={user} />
    </PageSection>
  );
}

function UserDetailFallback() {
  return (
    <PageSection
      section="Admin"
      title="User"
      description="Loading user account details..."
    >
      <SkeletonPageBody>
        <Skeleton height="2rem" width="16rem" />
        <Skeleton height="12rem" width="100%" />
      </SkeletonPageBody>
    </PageSection>
  );
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const { userId } = await params;

  return (
    <Suspense fallback={<UserDetailFallback />}>
      <UserDetailData userId={userId} />
    </Suspense>
  );
}
