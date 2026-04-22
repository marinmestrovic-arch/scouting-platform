import type { SegmentResponse } from "@scouting-platform/contracts";
import React from "react";

import { formatSavedSegmentSummary } from "../../lib/catalog-filters";
import type {
  SavedSegmentOperationStatus,
  SavedSegmentsRequestState,
} from "./catalog-table-shared";

type CatalogSegmentsProps = Readonly<{
  pendingSegmentAction: string | null;
  savedSegmentName: string;
  savedSegmentOperationStatus: SavedSegmentOperationStatus;
  savedSegments: readonly SegmentResponse[];
  savedSegmentsRequestState: SavedSegmentsRequestState;
  onCreateSegment: () => void | Promise<void>;
  onDeleteSegment: (segment: SegmentResponse) => void | Promise<void>;
  onLoadSegment: (segment: SegmentResponse) => void;
  onRetrySavedSegments: () => void;
  onSavedSegmentNameChange: (value: string) => void;
}>;

export function CatalogSegments({
  pendingSegmentAction,
  savedSegmentName,
  savedSegmentOperationStatus,
  savedSegments,
  savedSegmentsRequestState,
  onCreateSegment,
  onDeleteSegment,
  onLoadSegment,
  onRetrySavedSegments,
  onSavedSegmentNameChange,
}: CatalogSegmentsProps) {
  const isSavingSegment = pendingSegmentAction === "create";
  const hasSavedSegments = savedSegments.length > 0;

  return (
    <section className="catalog-table__segments" aria-labelledby="catalog-segments-heading">
      <div className="catalog-table__segments-header">
        <div>
          <h2 id="catalog-segments-heading">Segments</h2>
          <p>Save a reusable slice of the catalog and bring it back in one click.</p>
        </div>
      </div>

      <div className="catalog-table__segments-actions">
        <label className="catalog-table__search">
          <span>Segment name</span>
          <input
            name="segmentName"
            onChange={(event) => {
              onSavedSegmentNameChange(event.target.value);
            }}
            placeholder="Space creators"
            suppressHydrationWarning
            type="text"
            value={savedSegmentName}
          />
        </label>

        <button
          className="catalog-table__button"
          disabled={isSavingSegment || savedSegmentName.trim().length === 0}
          onClick={() => {
            void onCreateSegment();
          }}
          suppressHydrationWarning
          type="button"
        >
          {isSavingSegment ? "Saving..." : "Save"}
        </button>
      </div>

      {savedSegmentOperationStatus.message ? (
        <p
          className={`catalog-table__segment-status catalog-table__segment-status--${savedSegmentOperationStatus.type}`}
          role={savedSegmentOperationStatus.type === "error" ? "alert" : undefined}
        >
          {savedSegmentOperationStatus.message}
        </p>
      ) : null}

      {savedSegmentsRequestState.status === "loading" && !hasSavedSegments ? (
        <p className="catalog-table__feedback catalog-table__feedback--loading">
          Loading saved segments...
        </p>
      ) : null}

      {savedSegmentsRequestState.status === "error" ? (
        <div className="catalog-table__feedback catalog-table__feedback--error" role="alert">
          <p>{savedSegmentsRequestState.error}</p>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            onClick={onRetrySavedSegments}
            suppressHydrationWarning
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!hasSavedSegments && savedSegmentsRequestState.status === "ready" ? (
        <p className="catalog-table__feedback catalog-table__feedback--empty">
          No saved segments yet.
        </p>
      ) : null}

      {hasSavedSegments ? (
        <ul className="catalog-table__segment-list">
          {savedSegments.map((segment) => {
            const isDeletingSegment = pendingSegmentAction === `delete:${segment.id}`;

            return (
              <li className="catalog-table__segment-item" key={segment.id}>
                <div className="catalog-table__segment-copy">
                  <h3>{segment.name}</h3>
                  <p>{formatSavedSegmentSummary(segment.filters)}</p>
                </div>
                <div className="catalog-table__segment-item-actions">
                  <button
                    className="catalog-table__button catalog-table__button--secondary"
                    disabled={pendingSegmentAction !== null}
                    onClick={() => {
                      onLoadSegment(segment);
                    }}
                    suppressHydrationWarning
                    type="button"
                  >
                    Load
                  </button>
                  <button
                    className="catalog-table__button catalog-table__button--secondary"
                    disabled={pendingSegmentAction !== null}
                    onClick={() => {
                      void onDeleteSegment(segment);
                    }}
                    suppressHydrationWarning
                    type="button"
                  >
                    {isDeletingSegment ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
