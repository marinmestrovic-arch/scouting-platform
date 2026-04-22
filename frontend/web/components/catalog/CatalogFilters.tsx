import React from "react";

import {
  countActiveCatalogFilters,
  hasActiveCatalogFilters,
  type CatalogCreatorFilterOptions,
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
    <div
      ref={rootRef}
      className="catalog-table__combobox"
    >
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

function SearchableMultiSelect({
  legend,
  options,
  selected,
  searchValue,
  onSearchChange,
  onToggle,
}: {
  legend: string;
  options: ReadonlyArray<CatalogFilterOption>;
  selected: readonly string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onToggle: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = useDismissOnOutsideClick<HTMLFieldSetElement>(isOpen, () => {
    setIsOpen(false);
  });
  const selectedSummary =
    selected.length === 0
      ? "Any"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;
  const visibleOptions = filterOptions(
    getOptionsWithSelectedValues(options, selected),
    searchValue,
  );

  return (
    <fieldset className="catalog-table__filter-group" ref={rootRef}>
      <legend>{legend}</legend>
      <div className="catalog-table__filter-pill">
        <button
          aria-expanded={isOpen}
          className="catalog-table__filter-pill-trigger"
          onClick={() => {
            setIsOpen((current) => !current);
          }}
          type="button"
        >
          <span>{selectedSummary}</span>
        </button>
        {isOpen ? (
          <div className="catalog-table__filter-popover">
          <label className="catalog-table__filter-search">
            <span>{legend}</span>
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
    </fieldset>
  );
}

function MetricRangeSlider({
  legend,
  minKey,
  maxKey,
  draftFilters,
  onNumericFilterChange,
}: {
  legend: string;
  minKey: CatalogNumericFilterKey;
  maxKey: CatalogNumericFilterKey;
  draftFilters: CatalogFiltersState;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
}) {
  const minValue = draftFilters[minKey];
  const maxValue = draftFilters[maxKey];
  const minIndex = getNearestMetricStepIndex(minValue, 0);
  const maxIndex = getNearestMetricStepIndex(maxValue, LAST_METRIC_STEP_INDEX);
  const boundedMinIndex = Math.min(minIndex, maxIndex);
  const boundedMaxIndex = Math.max(maxIndex, minIndex);
  const selectedRangeStart = (boundedMinIndex / LAST_METRIC_STEP_INDEX) * 100;
  const selectedRangeEnd = (boundedMaxIndex / LAST_METRIC_STEP_INDEX) * 100;

  return (
    <fieldset className="catalog-table__filter-group">
      <legend>{legend}</legend>
      <div className="catalog-table__range-control">
        <div className="catalog-table__range-summary">
          <span>{getRangeSummary(minValue, maxValue)}</span>
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
            aria-label={`${legend} minimum`}
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
            aria-label={`${legend} maximum`}
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
    </fieldset>
  );
}

type CatalogFiltersProps = Readonly<{
  creatorFilterOptions: CatalogCreatorFilterOptions;
  draftFilters: CatalogFiltersState;
  hasPendingFilterChanges: boolean;
  searchOptions: readonly CatalogSearchOption[];
  onApplyFilters: () => void;
  onDraftQueryChange: (value: string) => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
  onResetFilters: () => void;
  onToggleMultiValueFilter: (key: CatalogMultiValueFilterKey, value: string) => void;
}>;

export function CatalogFilters({
  creatorFilterOptions,
  draftFilters,
  hasPendingFilterChanges,
  searchOptions,
  onApplyFilters,
  onDraftQueryChange,
  onNumericFilterChange,
  onResetFilters,
  onToggleMultiValueFilter,
}: CatalogFiltersProps) {
  const [dropdownSearch, setDropdownSearch] = React.useState<Record<CatalogMultiValueFilterKey, string>>({
    countryRegion: "",
    influencerVertical: "",
    influencerType: "",
  });
  const activeFilters = hasActiveCatalogFilters(draftFilters);
  const activeFilterCount = countActiveCatalogFilters(draftFilters);

  return (
    <details className="catalog-layout__rail" open>
      <summary className="catalog-layout__summary">Filters</summary>
      <section className="catalog-table__filters" aria-labelledby="catalog-filter-heading">
        <div className="catalog-table__filters-header">
          <div>
            <h2 id="catalog-filter-heading">Filters</h2>
          </div>
          {activeFilterCount > 0 ? (
            <span className="catalog-table__filters-badge">{activeFilterCount} active</span>
          ) : null}
        </div>

        <SearchCreatorDropdown
          onChange={onDraftQueryChange}
          options={searchOptions}
          value={draftFilters.query}
        />

        <SearchableMultiSelect
          legend="Country/Region"
          onToggle={(value) => onToggleMultiValueFilter("countryRegion", value)}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, countryRegion: value }));
          }}
          options={creatorFilterOptions.countryRegion}
          searchValue={dropdownSearch.countryRegion}
          selected={draftFilters.countryRegion}
        />

        <SearchableMultiSelect
          legend="Influencer Vertical"
          onToggle={(value) => onToggleMultiValueFilter("influencerVertical", value)}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, influencerVertical: value }));
          }}
          options={creatorFilterOptions.influencerVertical}
          searchValue={dropdownSearch.influencerVertical}
          selected={draftFilters.influencerVertical}
        />

        <SearchableMultiSelect
          legend="Influencer Type"
          onToggle={(value) => onToggleMultiValueFilter("influencerType", value)}
          onSearchChange={(value) => {
            setDropdownSearch((current) => ({ ...current, influencerType: value }));
          }}
          options={creatorFilterOptions.influencerType}
          searchValue={dropdownSearch.influencerType}
          selected={draftFilters.influencerType}
        />

        <MetricRangeSlider
          draftFilters={draftFilters}
          legend="YouTube Video Median Views"
          maxKey="youtubeVideoMedianViewsMax"
          minKey="youtubeVideoMedianViewsMin"
          onNumericFilterChange={onNumericFilterChange}
        />

        <MetricRangeSlider
          draftFilters={draftFilters}
          legend="YouTube Shorts Median Views"
          maxKey="youtubeShortsMedianViewsMax"
          minKey="youtubeShortsMedianViewsMin"
          onNumericFilterChange={onNumericFilterChange}
        />

        <MetricRangeSlider
          draftFilters={draftFilters}
          legend="YouTube Followers"
          maxKey="youtubeFollowersMax"
          minKey="youtubeFollowersMin"
          onNumericFilterChange={onNumericFilterChange}
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
