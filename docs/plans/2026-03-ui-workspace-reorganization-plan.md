# UI Workspace Reorganization Plan

## Summary

- Save as `docs/plans/2026-03-ui-workspace-reorganization-plan.md`.
- This is a frontend-only redesign inspired by `frontend_arch_platform`; no backend, worker, schema, or contract changes.
- New primary IA: `Dashboard`, `New scouting`, `Database`, `Admin`.
- `Database` becomes the main working surface and absorbs today’s `Catalog` and `Runs`; CSV export and HubSpot move from primary-nav pages to contextual actions.
- Keep legacy routes as wrappers or redirects so the rollout is reversible and existing deep links do not break.

## Interface Changes

- Add frontend routes `/dashboard`, `/new-scouting`, and `/database`.
- Use `/database?tab=runs|catalog&runId=<uuid>` for tab state and deep-linking a selected run.
- Keep `/catalog`, `/runs`, and `/runs/new` as compatibility aliases to the new workspaces; keep `/exports` and `/hubspot` reachable for batch history/detail follow-through, but remove them from primary nav.
- Reuse existing APIs only: `/api/runs`, `/api/runs/:id`, `/api/channels`, `/api/csv-export-batches`, `/api/hubspot-push-batches`.

## Implementation Steps

1. Refresh the authenticated shell to match the mock’s stronger workspace feel: top sticky grouped nav, clearer page headers, KPI cards, denser table surfaces, and shared filter/action styling, all built in the current Next.js + CSS setup without adding a new UI framework.
2. Build `/database` as a two-tab workspace. The `Runs` tab shows recent runs plus a selected-run detail panel, and row/header actions fetch run details to export all result `channelIds` to CSV or push them to HubSpot. The `Catalog` tab reuses the current creator table, selection model, and existing export/push flows with improved layout and copy.
3. Build `/new-scouting` as a single-panel form based on the mock. Only the prompt field is live and maps to the current run `query`; the submitted `name` is auto-generated client-side. `Campaign`, `week`, `source mode`, `brief upload`, `creators needed`, `platform`, and threshold fields render as clearly disabled planned controls, with `scouting + database` shown as the fixed current backend behavior.
4. Build `/dashboard` as a run operations board. Each row deep-links to `/database?tab=runs&runId=...` and exposes `Export CSV` / `Import to HubSpot` actions for the full run. The requested week/client/manager filters, summary cards, and `Client and Market` / `Campaign manager` / `Target` / `Coverage` columns stay visible as disabled scaffolds with explicit “requires campaign metadata backend” copy; live row data comes from current run status, timestamps, and result counts.
5. Finish compatibility and verification work: swap primary nav labels, keep old routes redirecting or wrapping the new pages, preserve batch result pages as post-action destinations, update route/component tests, and add this execution plan document under `docs/plans`.

## Test Plan

- Route and navigation tests for the new IA and legacy-route compatibility.
- Database workspace tests for tab switching, `runId` deep links, catalog preservation, and run-level CSV/HubSpot actions.
- New scouting tests proving only supported payload fields are submitted and disabled controls never affect the request.
- Dashboard tests for row actions, scaffolded unavailable states, and no unsupported API calls from disabled filters.
- Regression tests for existing export batch and HubSpot batch result flows reached from the new contextual buttons.

## Assumptions

- No backend changes means `/api/runs` stays current-user scoped and limited to the latest 10 runs.
- No real campaign, market, week, target, or manager metadata exists in current contracts, so those UI elements must not fabricate persisted state.
- Catalog filtering stays limited to the currently supported query plus enrichment/report status filters.
- CSV export can be filtered or selected on the catalog side; HubSpot remains selected-channel only; run-level actions expand a run into selected `channelIds` by fetching `/api/runs/:id` first.
