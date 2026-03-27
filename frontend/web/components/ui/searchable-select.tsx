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

type SearchableSelectOption = Readonly<{
  value: string;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
}>;

type SearchableSelectProps = Readonly<{
  ariaLabel?: string;
  disabled?: boolean;
  emptySearchMessage?: string;
  options: readonly SearchableSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  value: string;
  onChange: (value: string) => void;
}>;

type SearchableSelectState = {
  isOpen: boolean;
  searchQuery: string;
};

type SearchableSelectAction =
  | { type: "close" }
  | { type: "open" }
  | { type: "set-search"; value: string }
  | { type: "toggle" };

const INITIAL_STATE: SearchableSelectState = {
  isOpen: false,
  searchQuery: "",
};

function reducer(state: SearchableSelectState, action: SearchableSelectAction): SearchableSelectState {
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

export function SearchableSelect({
  ariaLabel,
  disabled = false,
  emptySearchMessage = "No matching options found.",
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search options...",
  value,
}: SearchableSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const deferredSearchQuery = useDeferredValue(state.searchQuery);

  const selectedOption = options.find((option) => option.value === value) ?? null;
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

  return (
    <div
      className={`searchable-select${state.isOpen ? " searchable-select--open" : ""}`}
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
        <span className={`searchable-select__value${selectedOption ? "" : " searchable-select__value--placeholder"}`}>
          {selectedOption?.label ?? placeholder}
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

          <div aria-label={ariaLabel ?? placeholder} className="searchable-select__options" id={listboxId} role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  aria-selected={option.value === value}
                  className={`searchable-select__option${option.value === value ? " searchable-select__option--selected" : ""}`}
                  data-searchable-select-option="true"
                  disabled={option.disabled}
                  key={option.value || option.label}
                  onClick={() => {
                    onChange(option.value);
                    closePopover();
                    triggerRef.current?.focus();
                  }}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <span aria-hidden="true" className="searchable-select__check">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))
            ) : (
              <p className="searchable-select__empty">{emptySearchMessage}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { SearchableSelectOption };
