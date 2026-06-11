import React from "react";

import {
  countActiveCatalogFilters,
  type CatalogCreatorFilterOptions,
  type CatalogEnrichmentFilter,
  type CatalogFilterOption,
  type CatalogFiltersState,
  type CatalogMultiValueFilterKey,
  type CatalogNumericFilterKey,
} from "../../lib/catalog-filters";

type CatalogSearchOption = {
  value: string;
  label: string;
  meta: string;
};

const METRIC_RANGE_STEPS = [
  1000,
  2500,
  5000,
  10000,
  25000,
  50000,
  100000,
  250000,
  500000,
  750000,
  1000000,
] as const;

const LAST_METRIC_STEP_INDEX = METRIC_RANGE_STEPS.length - 1;

function useDismissOnOutsideClick<T extends HTMLElement>(
  isOpen: boolean,
  onDismiss: () => void,
): React.RefObject<T | null> {
  const rootRef = React.useRef<T | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current) {
        return;
      }

      if (!rootRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, onDismiss]);

  return rootRef;
}

function getOptionsWithSelectedValues(
  options: ReadonlyArray<CatalogFilterOption>,
  selected: readonly string[],
): CatalogFilterOption[] {
  const optionValues = new Set(options.map((option) => option.value));
  const missingSelectedOptions = selected
    .filter((value) => !optionValues.has(value))
    .map((value) => ({
      value,
      label: value,
    }));

  return [...options, ...missingSelectedOptions];
}

function filterOptions(
  options: ReadonlyArray<CatalogFilterOption>,
  query: string,
): CatalogFilterOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [...options];
  }

  return options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery),
  );
}

function formatMetricStep(value: number): string {
  if (value >= 1000000) {
    return "1M+";
  }

  if (value >= 1000) {
    return `${Number.parseFloat((value / 1000).toFixed(1)).toString()}K`;
  }

  return String(value);
}

function getNearestMetricStepIndex(value: string, fallbackIndex: number): number {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return fallbackIndex;
  }

  let nearestIndex = fallbackIndex;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, step] of METRIC_RANGE_STEPS.entries()) {
    const distance = Math.abs(step - parsedValue);

    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }

  return nearestIndex;
}

function getRangeSummary(minValue: string, maxValue: string): string {
  if (!minValue && !maxValue) {
    return "Any";
  }

  const minLabel = minValue ? formatMetricStep(Number(minValue)) : "1K";
  const maxLabel = maxValue ? formatMetricStep(Number(maxValue)) : "1M+";

  return `${minLabel} - ${maxLabel}`;
}

function SearchCreatorDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly CatalogSearchOption[];
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = useDismissOnOutsideClick<HTMLDivElement>(isOpen, () => {
    setIsOpen(false);
  });
  const normalizedQuery = value.trim().toLowerCase();
  const suggestions = options
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${option.label} ${option.meta} ${option.value}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 20);

  return (
    <div className="catalog-filter-bar__search" ref={rootRef}>
      <label className="catalog-table__search catalog-table__search--primary">
        <span>Search creators</span>
        <input
          aria-expanded={isOpen}
          aria-label="Search creators"
          name="query"
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
          }}
          placeholder="Search creators..."
          role="combobox"
          suppressHydrationWarning
          type="search"
          value={value}
        />
      </label>

      {isOpen ? (
        <div className="catalog-table__combobox-popover" role="listbox">
          {suggestions.length > 0 ? (
            suggestions.map((option) => (
              <button
                key={`${option.value}:${option.meta}`}
                className="catalog-table__combobox-option"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span>{option.label}</span>
                <small>{option.meta}</small>
              </button>
            ))
          ) : (
            <p className="catalog-table__filter-note">No matches</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MultiValueFilterChip({
  label,
  options,
  selected,
  searchValue,
  onSearchChange,
  onToggle,
  onClear,
}: {
  label: string;
  options: ReadonlyArray<CatalogFilterOption>;
  selected: readonly string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = useDismissOnOutsideClick<HTMLDivElement>(isOpen, () => {
    setIsOpen(false);
  });
  const isActive = selected.length > 0;
  const selectedSummary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${selected[0]}`
        : `${label}: ${selected.length} selected`;
  const visibleOptions = filterOptions(
    getOptionsWithSelectedValues(options, selected),
    searchValue,
  );

  return (
    <div className="catalog-filter-chip" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={isActive ? "catalog-filter-chip__trigger catalog-filter-chip__trigger--active" : "catalog-filter-chip__trigger"}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <span>{selectedSummary}</span>
      </button>

      {isActive ? (
        <button
          aria-label={`Clear ${label} filter`}
          className="catalog-filter-chip__clear"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
            setIsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
      ) : null}

      {isOpen ? (
        <div className="catalog-filter-chip__popover">
          <label className="catalog-table__filter-search">
            <span>{label}</span>
            <input
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
              placeholder="Search..."
              suppressHydrationWarning
              type="search"
              value={searchValue}
            />
          </label>
          <div className="catalog-table__filter-options" role="listbox">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
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
              })
            ) : (
              <p className="catalog-table__filter-note">No matches</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricRangeFilterChip({
  label,
  minKey,
  maxKey,
  filters,
  onClearNumericRangeFilter,
  onNumericFilterChange,
}: {
  label: string;
  minKey: CatalogNumericFilterKey;
  maxKey: CatalogNumericFilterKey;
  filters: CatalogFiltersState;
  onClearNumericRangeFilter: (minKey: CatalogNumericFilterKey, maxKey: CatalogNumericFilterKey) => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = useDismissOnOutsideClick<HTMLDivElement>(isOpen, () => {
    setIsOpen(false);
  });
  const minValue = filters[minKey];
  const maxValue = filters[maxKey];
  const isActive = minValue.length > 0 || maxValue.length > 0;
  const minIndex = getNearestMetricStepIndex(minValue, 0);
  const maxIndex = getNearestMetricStepIndex(maxValue, LAST_METRIC_STEP_INDEX);
  const boundedMinIndex = Math.min(minIndex, maxIndex);
  const boundedMaxIndex = Math.max(maxIndex, minIndex);
  const selectedRangeStart = (boundedMinIndex / LAST_METRIC_STEP_INDEX) * 100;
  const selectedRangeEnd = (boundedMaxIndex / LAST_METRIC_STEP_INDEX) * 100;
  const summary = getRangeSummary(minValue, maxValue);

  return (
    <div className="catalog-filter-chip" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={isActive ? "catalog-filter-chip__trigger catalog-filter-chip__trigger--active" : "catalog-filter-chip__trigger"}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <span>{isActive ? `${label}: ${summary}` : label}</span>
      </button>

      {isActive ? (
        <button
          aria-label={`Clear ${label} filter`}
          className="catalog-filter-chip__clear"
          onClick={(event) => {
            event.stopPropagation();
            onClearNumericRangeFilter(minKey, maxKey);
            setIsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
      ) : null}

      {isOpen ? (
        <div className="catalog-filter-chip__popover">
          <div className="catalog-table__range-control">
            <div className="catalog-table__range-summary">
              <span>{summary}</span>
            </div>
            <div
              className="catalog-table__dual-range"
              style={{
                "--catalog-range-start": `${selectedRangeStart}%`,
                "--catalog-range-end": `${selectedRangeEnd}%`,
              } as React.CSSProperties}
            >
              <div className="catalog-table__dual-range-track" />
              <input
                aria-label={`${label} minimum`}
                className="catalog-table__dual-range-input"
                max={LAST_METRIC_STEP_INDEX}
                min="0"
                name={minKey}
                onChange={(event) => {
                  const nextIndex = Math.min(Number(event.target.value), boundedMaxIndex);
                  const nextValue = METRIC_RANGE_STEPS[nextIndex];

                  onNumericFilterChange(minKey, nextIndex === 0 ? "" : String(nextValue));
                }}
                suppressHydrationWarning
                type="range"
                value={boundedMinIndex}
              />
              <input
                aria-label={`${label} maximum`}
                className="catalog-table__dual-range-input"
                max={LAST_METRIC_STEP_INDEX}
                min="0"
                name={maxKey}
                onChange={(event) => {
                  const nextIndex = Math.max(Number(event.target.value), boundedMinIndex);
                  const nextValue = METRIC_RANGE_STEPS[nextIndex];

                  onNumericFilterChange(
                    maxKey,
                    nextIndex === LAST_METRIC_STEP_INDEX ? "" : String(nextValue),
                  );
                }}
                suppressHydrationWarning
                type="range"
                value={boundedMaxIndex}
              />
            </div>
            <div className="catalog-table__range-scale" aria-hidden="true">
              <span>1K</span>
              <span>1M+</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ENRICHMENT_FILTER_OPTIONS: { value: CatalogEnrichmentFilter; label: string }[] = [
  { value: "enriched", label: "Enriched" },
  { value: "not_enriched", label: "Not enriched" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "failed", label: "Failed" },
  { value: "stale", label: "Stale" },
];

function EnrichmentStatusFilterChip({
  value,
  onChange,
}: {
  value: CatalogEnrichmentFilter | "";
  onChange: (value: CatalogEnrichmentFilter | "") => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = useDismissOnOutsideClick<HTMLDivElement>(isOpen, () => {
    setIsOpen(false);
  });
  const isActive = Boolean(value);
  const selectedLabel = ENRICHMENT_FILTER_OPTIONS.find((o) => o.value === value)?.label;

  return (
    <div className="catalog-filter-chip" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={isActive ? "catalog-filter-chip__trigger catalog-filter-chip__trigger--active" : "catalog-filter-chip__trigger"}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <span>{isActive ? `Enrichment: ${selectedLabel ?? value}` : "Enrichment"}</span>
      </button>

      {isActive ? (
        <button
          aria-label="Clear enrichment filter"
          className="catalog-filter-chip__clear"
          onClick={(event) => {
            event.stopPropagation();
            onChange("");
            setIsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
      ) : null}

      {isOpen ? (
        <div className="catalog-filter-chip__popover">
          <div className="catalog-table__filter-options" role="listbox">
            {ENRICHMENT_FILTER_OPTIONS.map((option) => {
              const checked = value === option.value;

              return (
                <label
                  key={option.value}
                  className={`catalog-table__filter-option${checked ? " catalog-table__filter-option--selected" : ""}`}
                >
                  <input
                    checked={checked}
                    onChange={() => {
                      onChange(checked ? "" : option.value);
                      setIsOpen(false);
                    }}
                    suppressHydrationWarning
                    type="radio"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type CatalogFiltersProps = Readonly<{
  creatorFilterOptions: CatalogCreatorFilterOptions;
  filters: CatalogFiltersState;
  searchOptions: readonly CatalogSearchOption[];
  onClearMultiValueFilter: (key: CatalogMultiValueFilterKey) => void;
  onClearNumericRangeFilter: (minKey: CatalogNumericFilterKey, maxKey: CatalogNumericFilterKey) => void;
  onEnrichmentStatusChange: (value: CatalogEnrichmentFilter | "") => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
  onQueryChange: (value: string) => void;
  onResetFilters: () => void;
  onToggleMultiValueFilter: (key: CatalogMultiValueFilterKey, value: string) => void;
}>;

export function CatalogFilters({
  creatorFilterOptions,
  filters,
  searchOptions,
  onClearMultiValueFilter,
  onClearNumericRangeFilter,
  onEnrichmentStatusChange,
  onNumericFilterChange,
  onQueryChange,
  onResetFilters,
  onToggleMultiValueFilter,
}: CatalogFiltersProps) {
  const [dropdownSearch, setDropdownSearch] = React.useState<Record<CatalogMultiValueFilterKey, string>>({
    countryRegion: "",
    influencerVertical: "",
    influencerType: "",
  });
  const activeFilterCount = countActiveCatalogFilters(filters);

  return (
    <section className="catalog-filter-bar" aria-label="Catalog filters">
      <SearchCreatorDropdown
        onChange={onQueryChange}
        options={searchOptions}
        value={filters.query}
      />

      <div className="catalog-filter-bar__chips">
        <MultiValueFilterChip
          label="Country/Region"
          onClear={() => onClearMultiValueFilter("countryRegion")}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, countryRegion: value }));
          }}
          onToggle={(value) => onToggleMultiValueFilter("countryRegion", value)}
          options={creatorFilterOptions.countryRegion}
          searchValue={dropdownSearch.countryRegion}
          selected={filters.countryRegion}
        />

        <MultiValueFilterChip
          label="Influencer Vertical"
          onClear={() => onClearMultiValueFilter("influencerVertical")}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, influencerVertical: value }));
          }}
          onToggle={(value) => onToggleMultiValueFilter("influencerVertical", value)}
          options={creatorFilterOptions.influencerVertical}
          searchValue={dropdownSearch.influencerVertical}
          selected={filters.influencerVertical}
        />

        <MultiValueFilterChip
          label="Influencer Type"
          onClear={() => onClearMultiValueFilter("influencerType")}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, influencerType: value }));
          }}
          onToggle={(value) => onToggleMultiValueFilter("influencerType", value)}
          options={creatorFilterOptions.influencerType}
          searchValue={dropdownSearch.influencerType}
          selected={filters.influencerType}
        />

        <MetricRangeFilterChip
          filters={filters}
          label="Video Median Views"
          maxKey="youtubeVideoMedianViewsMax"
          minKey="youtubeVideoMedianViewsMin"
          onNumericFilterChange={onNumericFilterChange}
          onClearNumericRangeFilter={onClearNumericRangeFilter}
        />

        <MetricRangeFilterChip
          filters={filters}
          label="Shorts Median Views"
          maxKey="youtubeShortsMedianViewsMax"
          minKey="youtubeShortsMedianViewsMin"
          onNumericFilterChange={onNumericFilterChange}
          onClearNumericRangeFilter={onClearNumericRangeFilter}
        />

        <MetricRangeFilterChip
          filters={filters}
          label="YouTube Followers"
          maxKey="youtubeFollowersMax"
          minKey="youtubeFollowersMin"
          onNumericFilterChange={onNumericFilterChange}
          onClearNumericRangeFilter={onClearNumericRangeFilter}
        />

        <EnrichmentStatusFilterChip
          onChange={onEnrichmentStatusChange}
          value={filters.enrichmentStatus}
        />

        <button
          className="catalog-table__button catalog-table__button--secondary catalog-filter-bar__clear-all"
          disabled={activeFilterCount === 0}
          onClick={onResetFilters}
          suppressHydrationWarning
          type="button"
        >
          Clear all
        </button>
      </div>
    </section>
  );
}
