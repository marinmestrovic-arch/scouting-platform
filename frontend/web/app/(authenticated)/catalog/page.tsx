import React from "react";
import { listChannels, listUserSegments } from "@scouting-platform/core";

import { auth } from "../../../auth";
import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageSection } from "../../../components/layout/page-section";
import { parseCatalogFiltersFromSearchParams } from "../../../lib/catalog-filters";

type CatalogPageProps = Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

function toUrlSearchParams(
  input: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }

      continue;
    }

    if (typeof value === "string") {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const session = await auth();
  const resolvedSearchParams = toUrlSearchParams((await searchParams) ?? {});
  const filters = parseCatalogFiltersFromSearchParams(resolvedSearchParams);
  const rawPage = Number.parseInt(resolvedSearchParams.get("page") ?? "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [initialData, initialSavedSegments] = await Promise.all([
    listChannels({
      page,
      pageSize: 20,
      ...(filters.query ? { query: filters.query } : {}),
      ...(filters.enrichmentStatus.length > 0
        ? { enrichmentStatus: filters.enrichmentStatus }
        : {}),
      ...(filters.advancedReportStatus.length > 0
        ? { advancedReportStatus: filters.advancedReportStatus }
        : {}),
    }),
    session?.user?.id ? listUserSegments(session.user.id) : Promise.resolve([]),
  ]);

  return (
    <PageSection
      title="Catalog"
      description="Browse the canonical creator catalog with full-width filters, enrichment actions, and export shortcuts."
    >
      <DatabaseWorkspace
        forcedTab="catalog"
        initialCatalogData={initialData}
        initialSavedSegments={initialSavedSegments}
      />
    </PageSection>
  );
}
