# Codex Implementation Guide: UX Foundation + Dashboard + Catalog Redesign

- Status: Not started
- Date: 2026-04-21
- Owner: Ivan
- Scope: Phase 1 (Foundation) → Phase 2 (Dashboard) → Phase 3 (Catalog)
- Non-goals: replacing the design system, introducing Tailwind/shadcn, changing the palette.

## Design principles (apply to every task)

1. **Keep the current palette.** Do not alter the OKLCH/hex values for `--color-canvas` (`#f6f7f4`), `--color-accent` (`#000f41`), `--color-highlight` (`#f2ff82`), or the navy/lime gradient backgrounds in `frontend/web/app/globals.css:1–69`. Sharpen hierarchy, don't rebrand.
2. **No new UI framework.** Stay on hand-rolled BEM CSS + CSS variables. Extend `globals.css` and add new BEM prefixes for new primitives (e.g. `data-table__`, `page-header__`, `timeline__`).
3. **Extract, don't rewrite.** When a component exceeds ~400 lines, split by responsibility (filters, table, batch, segments) into sibling files under the same folder. Keep exported props stable.
4. **Reuse existing utilities.** `run-presentation.ts`, `SkeletonTable`, `SearchableSelect`, `formatRunStatusLabel`, `formatRunTimestamp`, etc. Do NOT create duplicates.
5. **Accessibility baseline.** Every new table gets a sticky `<thead>` with `scope="col"`. Every new interactive pill/filter gets a visible `:focus-visible` ring using `--color-accent`. Reduced-motion: wrap any non-trivial transition in `@media (prefers-reduced-motion: reduce)`.
6. **Polling is not silent.** Any async refresh loop must show an inline indicator (subtle "Updating…" chip) so the user knows the screen is live.

## Context

The app review surfaced three issues that compound across most screens: tables scroll horizontally without sticky headers and lose context; the dashboard doesn't differentiate run status strongly enough for scanning; and `catalog-table-shell.tsx` has grown to ~2,240 lines bundling filters, segments, table, batch cards, and HubSpot push UI into one file. Rather than redesign every screen, this plan builds shared primitives first (Phase 1), then applies them to the two highest-traffic surfaces (dashboard — Phase 2, catalog — Phase 3).

File anchors:
- Tokens & global styles: `frontend/web/app/globals.css`
- App shell header: `.auth-shell__header` at `globals.css:104`
- Dashboard: `frontend/web/components/dashboard/dashboard-workspace.tsx`
- Catalog: `frontend/web/components/catalog/catalog-table-shell.tsx`
- Run detail: `frontend/web/components/runs/run-detail-shell.tsx`
- Shared UI: `frontend/web/components/ui/` (SearchableSelect, Skeleton, etc.)

---

## Phase 1 — Foundation

Goal: build the primitives so Phases 2 and 3 are mostly re-composition, not CSS invention.

### Task 1.1: Spacing + radius token audit

**Why:** `--space-4` and `--space-5` are both `1rem` (`globals.css:21–22`). That collapses the scale and makes density tuning inconsistent.

**File:** `frontend/web/app/globals.css:17–44`

1. Replace the duplicate `--space-5: 1rem;` with `--space-5: 1.125rem;` so the scale is monotonic.
2. Add `--space-7: 1.5rem;` between `--space-6` and `--space-8`. Many existing rules already use ad-hoc `1.5rem` literals — `rg "1\\.5rem" frontend/web/app/globals.css` first and replace the obvious ones with `var(--space-7)` in the same pass only if safe (grep count ≤ 20, otherwise leave them).
3. Add `--radius-xs: 0.25rem;` for inline pill/chip use. Don't touch existing `--radius-sm/md/lg`.

**Acceptance:**
- `globals.css` diff is only additions + the `--space-5` bump.
- `pnpm --filter @scouting-platform/web test` passes (existing snapshot tests should be unaffected because pixel values change only where `--space-5` was used).
- Visual diff on the dashboard is negligible (≤2px shift anywhere).

### Task 1.2: `data-table` primitive (sticky header + density knob)

**Why:** Every table on every page scrolls with a non-sticky header. Users lose column context immediately.

**Files:**
- `frontend/web/app/globals.css` — add a new block at the end, clearly delimited with `/* === data-table primitive === */`.
- `frontend/web/components/ui/DataTable.tsx` — NEW file. Thin React wrapper that emits the BEM classes below.

**BEM to add:**
```css
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.data-table__scroll { overflow-x: auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border); background: var(--color-surface); }
.data-table thead th {
  position: sticky; top: 0; z-index: var(--z-sticky);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-strong);
  text-align: left; font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-200); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--color-text-muted);
  padding: var(--space-3) var(--space-4);
}
.data-table tbody td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.data-table tbody tr:last-child td { border-bottom: 0; }
.data-table tbody tr:hover { background: var(--color-accent-soft); }
.data-table--compact tbody td, .data-table--compact thead th { padding: var(--space-2) var(--space-3); }
```

**React contract (DataTable.tsx):**
```tsx
export function DataTable({
  density = "regular",
  children,
  caption,
}: {
  density?: "regular" | "compact";
  children: React.ReactNode;
  caption?: string;
}) { /* wraps <div.data-table__scroll><table class="data-table data-table--{density}">…</table></div> and optional <caption> sr-only */ }
```

**Acceptance:**
- Scrolling the dashboard table horizontally keeps `<thead>` visible at the top of the scroll container.
- `:hover` on a row tints with `--color-accent-soft`.
- Keyboard focus is unchanged (no focus trap introduced).
- No visual regression on screens that have NOT been migrated yet (the primitive is opt-in; existing tables keep their classes until Phase 2/3).

### Task 1.3: `status-pill` + `timeline` primitives

**Why:** Run/job status is currently text with a colored background on the dashboard only. Run detail shows plain text. A shared pill + a small horizontal timeline makes status scannable everywhere.

**Files:**
- `frontend/web/app/globals.css` — add `/* === status primitives === */` block.
- `frontend/web/components/ui/StatusPill.tsx` — NEW.
- `frontend/web/components/ui/StatusTimeline.tsx` — NEW.

**BEM:**
```css
.status-pill {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: 0.2rem 0.6rem; border-radius: 999px;
  font-size: var(--font-size-200); font-weight: var(--font-weight-semibold);
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}
.status-pill__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; }
.status-pill--queued    { background: var(--color-surface-muted); color: var(--color-text-muted); }
.status-pill--running   { background: var(--color-highlight-soft); color: var(--color-accent); border-color: var(--color-highlight); }
.status-pill--completed { background: rgba(34, 139, 84, 0.12); color: #175a37; }
.status-pill--failed    { background: rgba(194, 58, 58, 0.12); color: #8e1f1f; }

.status-pill--running .status-pill__dot { animation: status-pulse 1.6s ease-in-out infinite; }
@keyframes status-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .status-pill--running .status-pill__dot { animation: none; } }

.timeline { display: flex; align-items: center; gap: var(--space-3); font-size: var(--font-size-200); color: var(--color-text-muted); }
.timeline__step { display: inline-flex; align-items: center; gap: var(--space-2); }
.timeline__marker { width: 0.75rem; height: 0.75rem; border-radius: 50%; background: var(--color-surface-muted); border: 2px solid var(--color-border); }
.timeline__step--done .timeline__marker { background: var(--color-accent); border-color: var(--color-accent); }
.timeline__step--active .timeline__marker { background: var(--color-highlight); border-color: var(--color-accent); }
.timeline__connector { flex: 1 1 auto; height: 2px; background: var(--color-border); }
.timeline__step--done + .timeline__connector { background: var(--color-accent); }
```

**React contract:**
```tsx
export function StatusPill({ status }: { status: "queued" | "running" | "completed" | "failed" }) { /* uses formatRunStatusLabel */ }
export function StatusTimeline({ steps }: { steps: { key: string; label: string; state: "todo" | "active" | "done" }[] }) {}
```

**Reuse:** `formatRunStatusLabel` from `frontend/web/components/runs/run-presentation.ts`. Do NOT re-derive labels in the component.

**Acceptance:**
- Rendering `<StatusPill status="running" />` shows a lime pulse dot (disabled under reduced-motion).
- `StatusTimeline` renders inline and wraps cleanly below ~420px width.
- Both primitives have unit tests in `frontend/web/components/ui/__tests__/` covering all four statuses + the three timeline states.

### Task 1.4: `page-header` primitive + breadcrumbs

**Why:** Every authenticated page currently hand-rolls its own title row. There's no breadcrumb, so users inside `/runs/[runId]` have no "back to dashboard" affordance beyond the browser.

**Files:**
- `frontend/web/components/layout/PageHeader.tsx` — NEW.
- `frontend/web/app/globals.css` — `.page-header`, `.page-header__crumbs`, `.page-header__title`, `.page-header__actions`.

**React contract:**
```tsx
export function PageHeader({
  title,
  description,
  crumbs,            // [{ label, href }] — last entry is current, rendered non-link
  actions,           // ReactNode — right-aligned action cluster
  live,              // optional "Updating…" indicator shown next to title when true
}: PageHeaderProps) {}
```

**BEM layout:**
- `.page-header` — flex row, wrap, aligns baseline, `gap: var(--space-4)`.
- `.page-header__crumbs` — `ol` with `/` separators, `font-size: var(--font-size-200)`, `color: var(--color-text-muted)`, current item `color: var(--color-text)`.
- `.page-header__title` — `h1`, `font-size: var(--font-size-700)`, `letter-spacing: -0.02em`.
- `.page-header__live` — right-aligned chip using `--color-highlight-soft` background and a tiny pulsing dot (reuse `status-pill--running` styles).

**Acceptance:**
- Dashboard page, run detail page, and catalog page all render the same `PageHeader`.
- Breadcrumb links are keyboard-focusable and show a `:focus-visible` outline in `--color-accent`.
- The `live` indicator is the SAME visual vocabulary as `StatusPill`'s running pulse — do not invent a new animation.

### Task 1.5: Standard `EmptyState` + `ErrorState`

**Why:** Empty/error UX is inconsistent across pages (some show plain paragraphs, some show nothing). A shared primitive keeps tone and spacing in line.

**Files:**
- `frontend/web/components/ui/EmptyState.tsx`, `frontend/web/components/ui/ErrorState.tsx` — NEW.
- `frontend/web/app/globals.css` — `.empty-state`, `.error-state`.

**React contract:**
```tsx
<EmptyState title="No runs yet" description="Start by creating a scouting run." action={<a href="/new-scouting">New run</a>} />
<ErrorState title="Couldn't load catalog" description={message} onRetry={() => refetch()} />
```

**Acceptance:**
- Both primitives use `--color-surface`, dashed `--color-border-strong` border, center-aligned content, padding `var(--space-8)`.
- `ErrorState` `Retry` button uses accent color and shows a focus ring.

---

## Phase 2 — Dashboard redesign

Use ONLY the primitives from Phase 1. No new CSS invention in this phase.

### Task 2.1: Replace the dashboard table with `DataTable`

**Why:** Sticky header is the single biggest scanning win for the main workspace.

**File:** `frontend/web/components/dashboard/dashboard-workspace.tsx` (around lines 275–360)

1. Wrap the current `<table>` in `<DataTable density="regular">…</DataTable>`.
2. Remove the bespoke `overflow-x: auto` wrapper CSS on `.dashboard-workspace__table` — rely on `data-table__scroll`. Keep the column-specific widths as inline styles or scoped BEM.
3. Replace the inline `.dashboard-workspace__status` span with `<StatusPill status={run.status} />`. Leave the legacy class defined in globals.css untouched for now (Phase 3 cleanup).

**Acceptance:**
- `<thead>` stays visible while scrolling horizontally.
- All 9 columns render; skeleton fallback still uses `<SkeletonTable columns={9} rows={6} />`.
- `formatRunStatusLabel` still drives the visible label.

### Task 2.2: Quick filter pills above the table

**Why:** 50 unsorted runs force the user to scan. Four status filters cover 95% of scanning needs.

**File:** `frontend/web/components/dashboard/dashboard-workspace.tsx`

1. Add a top-of-table control row (outside `DataTable`) containing:
   - A search input filtering by `run.campaignName` + `run.listName` (case-insensitive contains).
   - Four toggle pills: `All`, `Running`, `Completed`, `Failed`. Use `StatusPill`'s classnames for visual consistency; wrap in `<button>` for a11y.
2. Filter client-side from the existing `RecentRunItem[]`. Do NOT introduce new server endpoints.
3. Persist the selected filter in `?status=` search param (use `useSearchParams` + `router.replace`, no effect loop). This respects the rule "URL as state".
4. When filter yields 0 rows, render `<EmptyState title="No runs match" description="Clear filters to see all runs." action={<button onClick={clear}>Clear</button>} />` inside the scroll container.

**Acceptance:**
- Selecting `Running` hides completed/failed rows.
- Reloading the page with `?status=running` preserves the filter.
- The pill for the active filter has an `--color-accent` outline; inactive pills use `--color-border`.

### Task 2.3: Live indicator on page header

**Why:** The dashboard already polls every `RUN_STATUS_POLL_INTERVAL_MS`. Users currently have no cue the view is live.

**File:** `frontend/web/components/dashboard/dashboard-workspace.tsx` + `frontend/web/app/(authenticated)/dashboard/page.tsx`

1. Lift the "is polling?" boolean (true when any visible run is `queued` or `running`) up to the workspace's top-level render.
2. Replace the hand-rolled title area with `<PageHeader title="Dashboard" crumbs={[{ label: "Dashboard" }]} live={isPolling} actions={…} />`.
3. Move the "New run" CTA into `PageHeader.actions`.

**Acceptance:**
- When any run is running, the header shows a pulsing "Updating…" chip; it disappears when all visible runs settle.
- No behavioral change to polling itself.

### Task 2.4: Cleanup

- Delete the now-unused `.dashboard-workspace__status*` CSS rules if every usage migrated. Grep first: `rg "dashboard-workspace__status" frontend/web`.
- Ensure `pnpm --filter @scouting-platform/web lint` and `pnpm --filter @scouting-platform/web test` are green.

---

## Phase 3 — Catalog redesign + component split

Highest-payoff, highest-risk phase. Do this LAST and only after Phase 1 + 2 are merged.

### Task 3.1: Split `catalog-table-shell.tsx` by responsibility

**Why:** 2,240 lines in one component is hard to review and harder to change safely. Split preserves behavior.

**File (current):** `frontend/web/components/catalog/catalog-table-shell.tsx`

1. Extract these siblings under `frontend/web/components/catalog/`:
   - `CatalogFilters.tsx` — search, enrichment status, advanced-report status, "clear all".
   - `CatalogSegments.tsx` — saved segments card + new-segment CTA.
   - `CatalogBatchCards.tsx` — CSV/HubSpot batch result cards.
   - `CatalogTable.tsx` — the actual `<DataTable>` body.
2. `catalog-table-shell.tsx` becomes a thin composition file (~250–400 lines): data fetching + state + rendering the four extracted pieces inside a `PageHeader`.
3. Props must stay minimal and typed. Do not introduce a context provider unless a prop touches ≥4 levels of depth.

**Acceptance:**
- Every existing test in `frontend/web/components/catalog/__tests__/` (or the file's own tests, if any) still passes without modification.
- `git diff --stat` shows the shell file reduced by ≥70%.
- No new `any` types.

### Task 3.2: Sticky table + filter rail layout

**Why:** Catalog has 8 visible columns and many filter controls. A two-column layout gives filters a home and keeps the table scannable.

**Files:** `CatalogTable.tsx`, `CatalogFilters.tsx`, `catalog-table-shell.tsx`, `globals.css`.

1. Add `.catalog-layout` in `globals.css`:
   ```css
   .catalog-layout { display: grid; grid-template-columns: 18rem minmax(0, 1fr); gap: var(--space-6); }
   @media (max-width: 960px) { .catalog-layout { grid-template-columns: 1fr; } }
   .catalog-layout__rail { position: sticky; top: calc(var(--space-8) + 1rem); align-self: start; }
   ```
2. Move `CatalogFilters` into the rail (`.catalog-layout__rail`). On narrow viewports, the rail becomes a collapsible `<details>` above the table.
3. `CatalogTable` uses `<DataTable>` — sticky header falls out for free.

**Acceptance:**
- Filters stay visible while scrolling the table on desktop.
- Mobile keeps full table width; filters collapse behind a "Filters" summary toggle.

### Task 3.3: Progressive batch UX

**Why:** Batch result cards currently sit above the table consuming vertical space even when empty/old. Collapse by default.

**File:** `CatalogBatchCards.tsx`

1. Render batch cards inside a `<details>` summary group labeled "Recent exports (N)". Open by default ONLY when the most recent batch is ≤60 minutes old or still `running`.
2. Each card uses `StatusPill` for run state (reuse Phase 1 primitive). Remove any bespoke status coloring.

**Acceptance:**
- Cold page load with no recent batch → batch section is collapsed.
- Kicking off a new CSV export auto-opens the section and shows the running pill.

### Task 3.4: Card/Table toggle (browsing mode)

**Why:** Table is great for bulk actions, bad for browsing unfamiliar channels. Give the user a toggle.

**File:** `CatalogTable.tsx`

1. Add a `view: "table" | "cards"` toggle in the top-right of the catalog page header (`PageHeader.actions`). Persist in `?view=` search param.
2. Card mode renders channels in a responsive grid (`grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr))`) with thumbnail, name, subscriber count, and a primary action.
3. Bulk selection + batch export is only available in table mode. Disable or hide the bulk-action bar in card mode with a tooltip ("Switch to table view to select multiple channels").

**Acceptance:**
- Toggle is keyboard-accessible (`role="tablist"` + `role="tab"` or a well-labeled button pair).
- Reloading with `?view=cards` preserves the mode.
- Row selection state is CLEARED when switching modes (do not silently carry it across views).

### Task 3.5: Cleanup

- Remove dead CSS under `.catalog-table__*` that no longer has a matching class in the split components.
- `pnpm --filter @scouting-platform/web lint`, `test`, and `build` must all pass.
- Visual smoke check on: empty catalog, 1 enriched channel, 200+ channels, running batch, failed batch.

---

## Cross-phase verification

After each phase:

1. `pnpm --filter @scouting-platform/web lint`
2. `pnpm --filter @scouting-platform/web test`
3. `pnpm --filter @scouting-platform/web build`
4. `pnpm --filter @scouting-platform/web playwright test` (existing Playwright config at `frontend/web/playwright.config.ts`) — fix any visual regressions before moving to the next phase.
5. Manual keyboard-only pass: tab through dashboard filter pills, sticky table focus order, catalog filter rail, view toggle. No focus traps, no hidden focus.
6. Reduced-motion pass: set `prefers-reduced-motion: reduce` in DevTools → no animated pulses.

## Sequencing notes for Codex

- **Do not skip Phase 1.** Phases 2 and 3 assume the primitives exist. If a primitive is missing, STOP and add it to Phase 1 rather than inlining.
- **Commit per task, not per phase.** Each task above is designed to be ≤300 LOC diff (except Task 3.1 which is a mechanical extraction).
- **Keep colors frozen.** If a task seems to require a new color, check whether `--color-accent-soft` / `--color-highlight-soft` / the green + red introduced in Task 1.3 cover it. Add a new token ONLY if absolutely necessary and note it in the PR description.
- **Do not modify the backend, API contracts, or data models.** This is UI-only.
