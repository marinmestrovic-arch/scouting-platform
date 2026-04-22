import type {
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
} from "@scouting-platform/contracts";
import React from "react";

import {
  ADVANCED_REPORT_FILTER_OPTIONS,
  ENRICHMENT_FILTER_OPTIONS,
  hasActiveCatalogFilters,
  type CatalogFilterOption,
  type CatalogFiltersState,
} from "../../lib/catalog-filters";

function FilterCheckboxGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: ReadonlyArray<CatalogFilterOption<T>>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="catalog-table__filter-group">
      <legend>{legend}</legend>
      <div className="catalog-table__filter-options">
        {options.map((option) => {
          const checked = selected.includes(option.value);

          return (
            <label
              key={option.value}
              className={`catalog-table__filter-option${checked ? " catalog-table__filter-option--selected" : ""}`}
            >
              <input
                checked={checked}
                onChange={() => {
                  onToggle(option.value);
                }}
                suppressHydrationWarning
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type CatalogFiltersProps = Readonly<{
  draftFilters: CatalogFiltersState;
  hasPendingFilterChanges: boolean;
  onApplyFilters: () => void;
  onDraftQueryChange: (value: string) => void;
  onResetFilters: () => void;
  onToggleAdvancedReportStatus: (value: ChannelAdvancedReportStatus) => void;
  onToggleEnrichmentStatus: (value: ChannelEnrichmentStatus) => void;
}>;

export function CatalogFilters({
  draftFilters,
  hasPendingFilterChanges,
  onApplyFilters,
  onDraftQueryChange,
  onResetFilters,
  onToggleAdvancedReportStatus,
  onToggleEnrichmentStatus,
}: CatalogFiltersProps) {
  const activeFilters = hasActiveCatalogFilters(draftFilters);
  const activeFilterCount =
    (draftFilters.query.trim() ? 1 : 0) +
    draftFilters.enrichmentStatus.length +
    draftFilters.advancedReportStatus.length;

  return (
    <details className="catalog-layout__rail" open>
      <summary className="catalog-layout__summary">Filters</summary>
      <section className="catalog-table__filters" aria-labelledby="catalog-filter-heading">
        <div className="catalog-table__filters-header">
          <div>
            <h2 id="catalog-filter-heading">Filters</h2>
            <p>Keep browsing criteria visible while the table scrolls.</p>
          </div>
          {activeFilterCount > 0 ? (
            <span className="catalog-table__filters-badge">{activeFilterCount} active</span>
          ) : null}
        </div>

        <label className="catalog-table__search catalog-table__search--primary">
          <span>Search creators</span>
          <input
            aria-label="Search creators"
            name="query"
            onChange={(event) => {
              onDraftQueryChange(event.target.value);
            }}
            placeholder="Search creators..."
            suppressHydrationWarning
            type="search"
            value={draftFilters.query}
          />
        </label>

        <FilterCheckboxGroup
          legend="Enrichment Status"
          onToggle={onToggleEnrichmentStatus}
          options={ENRICHMENT_FILTER_OPTIONS}
          selected={draftFilters.enrichmentStatus}
        />

        <FilterCheckboxGroup
          legend="Report Status"
          onToggle={onToggleAdvancedReportStatus}
          options={ADVANCED_REPORT_FILTER_OPTIONS}
          selected={draftFilters.advancedReportStatus}
        />

        <div className="catalog-table__filter-actions">
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!activeFilters && !hasPendingFilterChanges}
            onClick={onResetFilters}
            suppressHydrationWarning
            type="button"
          >
            Clear all
          </button>

          <button
            className="catalog-table__button"
            onClick={onApplyFilters}
            suppressHydrationWarning
            type="button"
          >
            Apply
          </button>
        </div>

        {hasPendingFilterChanges ? (
          <p className="catalog-table__filter-note">Draft changes are ready to apply.</p>
        ) : null}

        {activeFilterCount > 0 ? (
          <p className="catalog-table__filter-note">Active filters: {activeFilterCount}</p>
        ) : null}
      </section>
    </details>
  );
}
