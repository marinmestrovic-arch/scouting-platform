import React, { Suspense } from "react";
import type { DropdownValue } from "@scouting-platform/contracts";
import { getSession } from "../../../lib/cached-auth";
import {
  getCachedChannels,
  getCachedDropdownValues,
  getCachedUserSegments,
} from "../../../lib/cached-data";
import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageHeader } from "../../../components/layout/PageHeader";
import { SkeletonFilterBar, SkeletonPageBody, SkeletonTable } from "../../../components/ui/skeleton";
import {
  buildCatalogChannelFilters,
  parseCatalogFiltersFromSearchParams,
  type CatalogCreatorFilterOptions,
} from "../../../lib/catalog-filters";

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

function toCatalogCreatorFilterOptions(items: readonly DropdownValue[]): CatalogCreatorFilterOptions {
  return {
    countryRegion: items
      .filter((item) => item.fieldKey === "countryRegion")
      .map((item) => ({ value: item.value, label: item.value })),
    influencerVertical: items
      .filter((item) => item.fieldKey === "influencerVertical")
      .map((item) => ({ value: item.value, label: item.value })),
    influencerType: items
      .filter((item) => item.fieldKey === "influencerType")
      .map((item) => ({ value: item.value, label: item.value })),
  };
}

async function CatalogData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> | undefined }) {
  const session = await getSession();
  const resolvedSearchParams = toUrlSearchParams((await searchParams) ?? {});
  const filters = parseCatalogFiltersFromSearchParams(resolvedSearchParams);
  const requestFilters = buildCatalogChannelFilters(filters);
  const rawPage = Number.parseInt(resolvedSearchParams.get("page") ?? "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const initialData = await getCachedChannels({
    page,
    pageSize: 20,
    ...(requestFilters.query ? { query: requestFilters.query } : {}),
    ...(requestFilters.countryRegion?.length
      ? { countryRegion: requestFilters.countryRegion }
      : {}),
    ...(requestFilters.influencerVertical?.length
      ? { influencerVertical: requestFilters.influencerVertical }
      : {}),
    ...(requestFilters.influencerType?.length ? { influencerType: requestFilters.influencerType } : {}),
    ...(requestFilters.youtubeVideoMedianViewsMin !== undefined
      ? { youtubeVideoMedianViewsMin: requestFilters.youtubeVideoMedianViewsMin }
      : {}),
    ...(requestFilters.youtubeVideoMedianViewsMax !== undefined
      ? { youtubeVideoMedianViewsMax: requestFilters.youtubeVideoMedianViewsMax }
      : {}),
    ...(requestFilters.youtubeShortsMedianViewsMin !== undefined
      ? { youtubeShortsMedianViewsMin: requestFilters.youtubeShortsMedianViewsMin }
      : {}),
    ...(requestFilters.youtubeShortsMedianViewsMax !== undefined
      ? { youtubeShortsMedianViewsMax: requestFilters.youtubeShortsMedianViewsMax }
      : {}),
    ...(requestFilters.youtubeFollowersMin !== undefined
      ? { youtubeFollowersMin: requestFilters.youtubeFollowersMin }
      : {}),
    ...(requestFilters.youtubeFollowersMax !== undefined
      ? { youtubeFollowersMax: requestFilters.youtubeFollowersMax }
      : {}),
  });
  const initialSavedSegments = session?.user?.id ? await getCachedUserSegments(session.user.id) : [];
  const dropdownValuesResponse = await getCachedDropdownValues();

  return (
    <DatabaseWorkspace
      catalogCreatorFilterOptions={toCatalogCreatorFilterOptions(dropdownValuesResponse.items)}
      forcedTab="catalog"
      initialCatalogData={initialData}
      initialSavedSegments={initialSavedSegments}
    />
  );
}

function CatalogFallback() {
  return (
    <SkeletonPageBody>
      <SkeletonFilterBar filters={3} />
      <SkeletonTable columns={8} rows={8} />
    </SkeletonPageBody>
  );
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const resolvedSearchParams = toUrlSearchParams((await searchParams) ?? {});
  const view = resolvedSearchParams.get("view") === "cards" ? "cards" : "table";
  const tableParams = new URLSearchParams(resolvedSearchParams.toString());
  const cardsParams = new URLSearchParams(resolvedSearchParams.toString());

  tableParams.delete("view");
  cardsParams.set("view", "cards");

  const tableHref = tableParams.toString() ? `/catalog?${tableParams.toString()}` : "/catalog";
  const cardsHref = cardsParams.toString() ? `/catalog?${cardsParams.toString()}` : "/catalog";

  return (
    <section className="page-section">
      <PageHeader
        actions={
          <div aria-label="Catalog view" className="page-header__view-toggle" role="tablist">
            <a
              aria-selected={view === "table"}
              className={view === "table" ? "workspace-button" : "workspace-button workspace-button--secondary"}
              href={tableHref}
              role="tab"
            >
              Table
            </a>
            <a
              aria-selected={view === "cards"}
              className={view === "cards" ? "workspace-button" : "workspace-button workspace-button--secondary"}
              href={cardsHref}
              role="tab"
            >
              Cards
            </a>
          </div>
        }
        crumbs={[
          { label: "Database", href: "/database" },
          { label: "Catalog" },
        ]}
        description="Browse the canonical creator catalog with creator filters and table or card browsing modes."
        title="Catalog"
      />
      <div className="page-container page-section__body">
        <Suspense fallback={<CatalogFallback />}>
          <CatalogData searchParams={searchParams} />
        </Suspense>
      </div>
    </section>
  );
}
