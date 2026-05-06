"use client";

import React, {
  useDeferredValue,
  useId,
  useMemo,
  useReducer,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

type SearchableMultiSelectOption = Readonly<{
  value: string;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
}>;

type SearchableMultiSelectProps = Readonly<{
  ariaLabel?: string;
  disabled?: boolean;
  emptySearchMessage?: string;
  options: readonly SearchableMultiSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
}>;

type SearchableMultiSelectState = {
  isOpen: boolean;
  searchQuery: string;
};

type SearchableMultiSelectAction =
  | { type: "close" }
  | { type: "open" }
  | { type: "set-search"; value: string }
  | { type: "toggle" };

const INITIAL_STATE: SearchableMultiSelectState = {
  isOpen: false,
  searchQuery: "",
};

function reducer(state: SearchableMultiSelectState, action: SearchableMultiSelectAction): SearchableMultiSelectState {
  switch (action.type) {
    case "close":
      return {
        isOpen: false,
        searchQuery: "",
      };
    case "open":
      return {
        isOpen: true,
        searchQuery: "",
      };
    case "set-search":
      return {
        ...state,
        searchQuery: action.value,
      };
    case "toggle":
      return state.isOpen ? INITIAL_STATE : { isOpen: true, searchQuery: "" };
    default:
      return state;
  }
}

function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

function buildSelectedSummary(selectedLabels: readonly string[], placeholder: string): string {
  if (selectedLabels.length === 0) {
    return placeholder;
  }

  if (selectedLabels.length <= 2) {
    return selectedLabels.join(", ");
  }

  return `${selectedLabels.length} selected`;
}

function toggleSelectedValue(selectedValues: readonly string[], value: string): string[] {
  if (selectedValues.includes(value)) {
    return selectedValues.filter((selected) => selected !== value);
  }

  return [...selectedValues, value];
}

export function SearchableMultiSelect({
  ariaLabel,
  disabled = false,
  emptySearchMessage = "No matching options found.",
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search options...",
  values,
}: SearchableMultiSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const deferredSearchQuery = useDeferredValue(state.searchQuery);

  const selectedValueSet = useMemo(() => new Set(values), [values]);
  const selectedLabels = useMemo(() => {
    const selectedOptionLabels = options
      .filter((option) => selectedValueSet.has(option.value))
      .map((option) => option.label);

    const missingLabels = values.filter(
      (value) => !options.some((option) => option.value === value),
    );

    return [...selectedOptionLabels, ...missingLabels];
  }, [options, selectedValueSet, values]);

  const normalizedSearchQuery = normalizeSearchTerm(deferredSearchQuery);

  const filteredOptions = useMemo(() => {
    if (!normalizedSearchQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystacks = [option.label, ...(option.keywords ?? [])];
      return haystacks.some((entry) => normalizeSearchTerm(entry).includes(normalizedSearchQuery));
    });
  }, [normalizedSearchQuery, options]);

  function focusSearchInputSoon() {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }

  function closePopover() {
    dispatch({ type: "close" });
  }

  function handleToggle() {
    if (disabled) {
      return;
    }

    const willOpen = !state.isOpen;
    dispatch({ type: "toggle" });

    if (willOpen) {
      focusSearchInputSoon();
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocusTarget = event.relatedTarget;

    if (nextFocusTarget instanceof Node && rootRef.current?.contains(nextFocusTarget)) {
      return;
    }

    closePopover();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closePopover();
      triggerRef.current?.focus();
    }

    if (!state.isOpen && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      dispatch({ type: "open" });
      focusSearchInputSoon();
    }
  }

  const selectedSummary = buildSelectedSummary(selectedLabels, placeholder);

  return (
    <div
      className={`searchable-select searchable-select--multi${state.isOpen ? " searchable-select--open" : ""}`}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      ref={rootRef}
    >
      <button
        aria-controls={state.isOpen ? listboxId : undefined}
        aria-expanded={state.isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? placeholder}
        className="searchable-select__trigger"
        data-searchable-select-trigger="true"
        disabled={disabled}
        onClick={handleToggle}
        ref={triggerRef}
        type="button"
      >
        <span className={`searchable-select__value${selectedLabels.length > 0 ? "" : " searchable-select__value--placeholder"}`}>
          {selectedSummary}
        </span>
        <span aria-hidden="true" className="searchable-select__icon">
          ▾
        </span>
      </button>

      {state.isOpen ? (
        <div className="searchable-select__panel">
          <input
            className="searchable-select__search"
            onChange={(event) => {
              dispatch({ type: "set-search", value: event.currentTarget.value });
            }}
            placeholder={searchPlaceholder}
            ref={searchInputRef}
            type="text"
            value={state.searchQuery}
          />

          <div
            aria-label={ariaLabel ?? placeholder}
            aria-multiselectable="true"
            className="searchable-select__options"
            id={listboxId}
            role="listbox"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = selectedValueSet.has(option.value);

                return (
                  <button
                    aria-selected={isSelected}
                    className={`searchable-select__option${isSelected ? " searchable-select__option--selected" : ""}`}
                    data-searchable-select-option="true"
                    disabled={option.disabled}
                    key={option.value || option.label}
                    onClick={() => {
                      onChange(toggleSelectedValue(values, option.value));
                    }}
                    role="option"
                    type="button"
                  >
                    <span>{option.label}</span>
                    {isSelected ? (
                      <span aria-hidden="true" className="searchable-select__check">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="searchable-select__empty">{emptySearchMessage}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { SearchableMultiSelectOption };
