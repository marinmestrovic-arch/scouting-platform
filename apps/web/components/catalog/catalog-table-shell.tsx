"use client";

import type { ChannelSummary, ListChannelsResponse } from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchChannels } from "../../lib/channels-api";

type CatalogTableShellProps = {
  pageSize?: number;
};

type CatalogTableRequestState =
  | {
      status: "loading";
      data: null;
      error: null;
    }
  | {
      status: "error";
      data: null;
      error: string;
    }
  | {
      status: "ready";
      data: ListChannelsResponse;
      error: null;
    };

type CatalogTableShellViewProps = {
  requestState: CatalogTableRequestState;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

const DEFAULT_PAGE_SIZE = 20;

type CatalogPaginationState = Pick<ListChannelsResponse, "page" | "pageSize" | "total">;

function getEnrichmentLabel(channel: ChannelSummary): string {
  switch (channel.enrichment.status) {
    case "completed":
      return "Ready";
    case "failed":
      return "Failed";
    case "missing":
      return "Missing";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "stale":
      return "Stale";
    default:
      return channel.enrichment.status;
  }
}

export function formatChannelCountSummary(data: ListChannelsResponse): string {
  if (data.total === 0) {
    return "0 channels";
  }

  if (data.items.length === 0) {
    return `Showing 0 of ${data.total} channels`;
  }

  const firstItemIndex = (data.page - 1) * data.pageSize + 1;
  const lastItemIndex = firstItemIndex + data.items.length - 1;

  return `Showing ${firstItemIndex}-${Math.min(lastItemIndex, data.total)} of ${data.total} channels`;
}

export function getEmptyCatalogMessage(data: Pick<ListChannelsResponse, "total">): string {
  if (data.total === 0) {
    return "No channels found yet.";
  }

  return "No channels found on this page.";
}

export function hasPreviousCatalogPage(data: CatalogPaginationState): boolean {
  return data.page > 1;
}

export function hasNextCatalogPage(data: CatalogPaginationState): boolean {
  return data.page * data.pageSize < data.total;
}

export function getPreviousCatalogPage(data: CatalogPaginationState): number | null {
  if (!hasPreviousCatalogPage(data)) {
    return null;
  }

  return data.page - 1;
}

export function getNextCatalogPage(data: CatalogPaginationState): number | null {
  if (!hasNextCatalogPage(data)) {
    return null;
  }

  return data.page + 1;
}

function getChannelHandle(channel: ChannelSummary): string {
  return channel.handle?.trim() || "No handle";
}

function getIdentityFallback(channel: ChannelSummary): string {
  return channel.title.trim().charAt(0).toUpperCase() || "?";
}

export function CatalogTableShellView({
  requestState,
  onRetry,
  onPreviousPage,
  onNextPage,
}: CatalogTableShellViewProps) {
  if (requestState.status === "loading") {
    return <p className="catalog-table__feedback catalog-table__feedback--loading">Loading channels...</p>;
  }

  if (requestState.status === "error") {
    return (
      <div className="catalog-table__feedback catalog-table__feedback--error" role="alert">
        <p>{requestState.error}</p>
        <button className="catalog-table__button catalog-table__button--secondary" onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    );
  }

  const { data } = requestState;
  const hasChannels = data.items.length > 0;
  const hasPreviousPage = hasPreviousCatalogPage(data);
  const hasNextPage = hasNextCatalogPage(data);

  return (
    <div className="catalog-table">
      <div className="catalog-table__toolbar">
        <p className="catalog-table__summary">{formatChannelCountSummary(data)}</p>
        <div className="catalog-table__pagination">
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
            type="button"
          >
            Previous
          </button>
          <span className="catalog-table__page-indicator">Page {data.page}</span>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasNextPage}
            onClick={onNextPage}
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      {!hasChannels ? (
        <p className="catalog-table__feedback catalog-table__feedback--empty">
          {getEmptyCatalogMessage(data)}
        </p>
      ) : (
        <div className="catalog-table__table-wrap">
          <table className="catalog-table__table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">YouTube channel ID</th>
                <th scope="col">Enrichment</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    <div className="catalog-table__identity">
                      {channel.thumbnailUrl ? (
                        <Image
                          alt={`${channel.title} thumbnail`}
                          className="catalog-table__thumbnail"
                          height={48}
                          src={channel.thumbnailUrl}
                          unoptimized
                          width={48}
                        />
                      ) : (
                        <div className="catalog-table__thumbnail catalog-table__thumbnail--fallback" aria-hidden="true">
                          {getIdentityFallback(channel)}
                        </div>
                      )}
                      <div className="catalog-table__identity-copy">
                        <p className="catalog-table__title">{channel.title}</p>
                        <p className="catalog-table__meta">{getChannelHandle(channel)}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <code className="catalog-table__code">{channel.youtubeChannelId}</code>
                  </td>
                  <td>
                    <span
                      className={`catalog-table__status catalog-table__status--${channel.enrichment.status}`}
                    >
                      {getEnrichmentLabel(channel)}
                    </span>
                  </td>
                  <td>
                    <Link className="catalog-table__link" href={`/catalog/${channel.id}`}>
                      Open channel
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CatalogTableShell({ pageSize = DEFAULT_PAGE_SIZE }: CatalogTableShellProps) {
  const [page, setPage] = useState(1);
  const [requestState, setRequestState] = useState<CatalogTableRequestState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    setRequestState({
      status: "loading",
      data: null,
      error: null,
    });

    void fetchChannels(
      {
        page,
        pageSize,
      },
      abortController.signal,
    )
      .then((data) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: error instanceof Error && error.message ? error.message : "Unable to load channels. Please try again.",
        });
      });

    return () => {
      abortController.abort();
    };
  }, [page, pageSize, reloadToken]);

  return (
    <CatalogTableShellView
      onNextPage={() => {
        if (requestState.status !== "ready") {
          return;
        }

        const nextPage = getNextCatalogPage(requestState.data);

        if (nextPage === null) {
          return;
        }

        setPage(nextPage);
      }}
      onPreviousPage={() => {
        if (requestState.status !== "ready") {
          return;
        }

        const previousPage = getPreviousCatalogPage(requestState.data);

        if (previousPage === null) {
          return;
        }

        setPage(previousPage);
      }}
      onRetry={() => {
        setReloadToken((current) => current + 1);
      }}
      requestState={requestState}
    />
  );
}
