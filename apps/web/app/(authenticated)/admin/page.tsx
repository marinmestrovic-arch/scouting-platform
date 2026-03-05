import { PageSection } from "../../../components/layout/page-section";
import { canAccessNavigationKey } from "../../../lib/access-control";
import { DEFAULT_APP_ROLE } from "../../../lib/shell";
import { notFound } from "next/navigation";

export default function AdminPage() {
  if (!canAccessNavigationKey("admin", DEFAULT_APP_ROLE)) {
    notFound();
  }

  return (
    <PageSection
      title="Admin"
      description="Admin dashboard and management screens land in Week 5."
    />
  );
}
