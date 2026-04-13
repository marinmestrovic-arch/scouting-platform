# Codex Implementation Guide: Dashboard Quick Wins

- Status: Completed
- Date: 2026-04-03
- Owner: Ivan
- Completed: 2026-04-13

## Progress

- 2026-04-13: Reviewed the current dashboard implementation and confirmed all three quick wins were already present in code.
- Completed in code:
  - Dashboard status column wired to `formatRunStatusLabel()` with existing `dashboard-workspace__status` styling.
  - Dashboard started column wired to `formatRunTimestamp(run.createdAt)`.
  - Dashboard skeleton fallback updated to `columns={9}`.
- Verified by inspection:
  - `frontend/web/components/dashboard/dashboard-workspace.tsx`
  - `frontend/web/app/(authenticated)/dashboard/page.tsx`
- Verification caveat:
  - `pnpm --filter @scouting-platform/web test` could not run in this worktree because `node_modules` is missing and `vitest` is not available on the path.

## Context

An app review identified that the dashboard table is missing two critical columns: run status and creation date. The data and formatting utilities already exist — they just need to be wired into the dashboard table. This is a small, self-contained UI change touching only 2 files.

## Task 1: Add Status column to dashboard table

Status: Completed on 2026-04-13

**Why:** Runs have a `status` field (`queued | running | completed | failed`) but the dashboard table doesn't show it. Users can't tell which runs are still in flight.

**File:** `frontend/web/components/dashboard/dashboard-workspace.tsx`

1. Add import at the top:
   ```ts
   import { formatRunStatusLabel, RUN_STATUS_POLL_INTERVAL_MS, shouldPollRunStatus } from "../runs/run-presentation";
   ```
   (Note: `RUN_STATUS_POLL_INTERVAL_MS` and `shouldPollRunStatus` are already imported — just add `formatRunStatusLabel` to the existing import.)

2. Add `<th>Status</th>` in the `<thead>` after the "Coverage" `<th>` (around line 282).

3. Add a status pill `<td>` in the `<tbody>` row after the Coverage `<td>` (around line 312):
   ```tsx
   <td>
     <span className={`dashboard-workspace__status dashboard-workspace__status--${run.status}`}>
       {formatRunStatusLabel(run.status)}
     </span>
   </td>
   ```

**Existing utilities to reuse (do NOT create new ones):**
- `formatRunStatusLabel()` from `frontend/web/components/runs/run-presentation.ts`
- CSS classes `dashboard-workspace__status` + modifiers `--queued`, `--running`, `--completed`, `--failed` already exist in `frontend/web/app/globals.css` (search for `dashboard-workspace__status`)

## Task 2: Add Started date column to dashboard table

Status: Completed on 2026-04-13

**Why:** 50 unsorted runs with no date make the table hard to scan. `createdAt` is already on every `RecentRunItem`.

**File:** `frontend/web/components/dashboard/dashboard-workspace.tsx`

1. Add `formatRunTimestamp` to the import from `../runs/run-presentation`.

2. Add `<th>Started</th>` in the `<thead>` after the new Status `<th>`.

3. Add `<td>{formatRunTimestamp(run.createdAt)}</td>` in the `<tbody>` row after the Status `<td>`.

**Existing utilities to reuse (do NOT create new ones):**
- `formatRunTimestamp()` from `frontend/web/components/runs/run-presentation.ts` — formats ISO datetime to `YYYY-MM-DD HH:MM UTC`
- `createdAt` field already exists on `RecentRunItem` type from `@scouting-platform/contracts`

## Task 3: Update skeleton fallback column count

Status: Completed on 2026-04-13

**File:** `frontend/web/app/(authenticated)/dashboard/page.tsx`

Change `<SkeletonTable columns={7} rows={6} />` to `columns={9}` to account for the two new columns (Status + Started).

## Verification

1. Code inspection completed on 2026-04-13 for the dashboard table and fallback skeleton files.
2. `pnpm --filter @scouting-platform/web test` attempted on 2026-04-13, but the worktree is missing `node_modules`, so `vitest` was not available.
3. Live dashboard verification at `https://scouting.marsilux.com/dashboard` not performed from this session.
4. Status color behavior and loading skeleton column count were verified by existing code paths and class usage, not by a browser run in this session.
