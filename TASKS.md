# Tasks

## Work split

This split is by ownership surface, not skill hierarchy.

### You own:

- DB schema and migrations
- auth backend and session model
- queue/worker architecture
- YouTube / OpenAI / HypeAuditor integrations
- run orchestration
- enrichment pipeline backend
- Hype approval backend
- CSV import backend
- CI/CD and deployment

### Marin owns:

- app shell and UI system
- auth screens
- catalog list/detail UX
- saved segments UX
- run create/results UX
- admin dashboard UX
- CSV import UI
- manual edit UI
- Hype approval UI
- enrichment UI
- HubSpot import workflow frontend + backend
- Playwright e2e coverage

### Both of you:

- pair on schema and ADR decisions
- review every PR
- pair on final integration of each milestone
- never merge a Prisma migration without both reviewing it

## Milestone plan

Assuming 30h/week each, this is a realistic 8 week build.

### Week 0: Foundation

#### You:

- [done] create monorepo
- [done] set up Prisma + Postgres
- [done] set up pg-boss
- [done] set up base env/config package
- [done] set up GitHub Actions
- [done] write ADR-001 architecture
- [done] write ADR-002 data ownership and precedence

#### Marin:

- [done] bootstrap Next app
- [done] set up design tokens/layout/navigation
- [done] set up Auth.js UI flow
- [done] create base route protection and role-aware layout
- [done] create empty screens for catalog, runs, admin (`/catalog`, `/catalog/[channelId]`, `/runs`, `/admin`, `/admin/users`, `/admin/users/[userId]`)

Done when (Week 0 completion checkpoint):

- [done] repo built at Week 0 completion
- [done] CI was running at Week 0 completion
- [done] staging deploy path existed at Week 0 completion (repo is deploy-ready; follow `/docs/setup/staging-railway.md` for manual provisioning checklist)
- [done] auth shell existed at Week 0 completion
- [done] no feature code yet at Week 0 checkpoint

### Week 1: Auth, users, and catalog skeleton

#### You:

- [done] implement user/admin schema
- [done] credentials auth
- [done] session handling
- [done] encrypted YouTube key storage
- [done] admin user management backend
- [done] channel schema and repositories

#### Marin:

- [done] login screen
- [done] admin user management UI
- [done] account detail UI for user YouTube credential state
- [done] catalog table shell
- [done] channel detail shell

Done when:

- [done] admin can create a user
- [done] admin can assign/update YouTube key
- [done] user can log in
- [done] empty catalog pages load safely

### Week 2: Catalog browsing, segments, manual edit

#### You:

- [done] channel list/detail queries
- [done] segment persistence (phase 1: personal saved filter segments CRUD)
- [done] manual override model and merge logic (phase 2: per-field channel overrides with precedence-safe fallback restore)
- [done] audit events for edits (phase 2: admin channel override patches)

#### Marin:

- [done] catalog filters
- [done] channel detail page
- [done] saved segments UX
- [done] admin manual edit UI
- [done] row selection UX

Done when:

- [done] catalog list/detail works
- [done] segments save/load
- [done] admin manual edits persist and override automated values
- [done] evidence note: backend catalog queries are live via `GET /api/channels` and `GET /api/channels/:id` with integration coverage in `apps/web/app/api/week1.integration.test.ts`
- [done] evidence note: saved segments now work end-to-end in the catalog via `/api/segments` save/load/delete UX with coverage in `apps/web/lib/segments-api.test.ts`, `apps/web/components/catalog/catalog-table-shell.test.ts`, and `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`
- [done] evidence note: admin manual edit UI now ships on `/catalog/[channelId]` for admins via `/api/admin/channels/:id/manual-overrides`, with coverage in `apps/web/lib/admin-channels-api.test.ts`, `apps/web/components/catalog/admin-channel-manual-edit-panel.test.ts`, `apps/web/components/catalog/admin-channel-manual-edit-panel.behavior.test.ts`, `apps/web/components/catalog/channel-detail-shell.test.ts`, and `apps/web/app/(authenticated)/catalog/[channelId]/page.test.ts`
- [done] evidence note: row selection now works in the catalog table via per-row and per-page checkboxes, persistent selection state across paging/filter refreshes, and a clear-selection summary with coverage in `apps/web/components/catalog/catalog-table-shell.test.ts` and `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`

### Week 3: Runs and discovery

#### You:

- [done] run request model (phase 1: run request lifecycle persistence in `run_requests`)
- [done] run execution service (phase 1: queued -> running -> completed/failed transitions with persisted `last_error`)
- [done] YouTube discovery adapter using per-user key
- [done] dedupe/union with catalog
- [done] run result snapshot model (phase 1: `run_results` snapshot rows with rank/source)
- [done] background job for discovery (phase 1: `runs.discover` queue + worker execution wiring)

#### Marin:

- [done] create run UI
- [done] recent runs UI
- [done] run detail UI
- [done] progress/status polling
- [done] clear error states for missing YouTube key or quota failure

Done when:

- [done] manager can create a run
- [done] run uses both catalog and new discovery
- [done] results are saved and viewable
- [done] phased delivery note: Week 3 backend is delivered end-to-end (`GET /api/runs`, `POST /api/runs`, `GET /api/runs/:id`, queue/worker lifecycle, per-user-key YouTube discovery, deduped catalog+discovery union ranking, and snapshot persistence); create/detail/status/error/recent-history Week 3 UI is now shipped.
- [done] evidence note: runs UI now ships on `/runs`, `/runs/new`, and `/runs/[runId]`, including create submission, a recent-runs history panel backed by `GET /api/runs`, automatic status polling for `queued/running` runs, visible failure copy for missing YouTube key and quota exhaustion, and focused coverage in `apps/web/lib/runs-api.test.ts`, `apps/web/components/runs/create-run-shell.test.ts`, `apps/web/components/runs/create-run-shell.behavior.test.ts`, `apps/web/components/runs/recent-runs-shell.test.ts`, `apps/web/components/runs/recent-runs-shell.behavior.test.ts`, `apps/web/components/runs/run-detail-shell.test.ts`, `apps/web/components/runs/run-detail-shell.behavior.test.ts`, `apps/web/app/(authenticated)/runs/page.test.ts`, `apps/web/app/(authenticated)/runs/new/page.test.ts`, `apps/web/app/(authenticated)/runs/[runId]/page.test.ts`, `packages/core/src/week3.integration.test.ts`, and `apps/web/app/api/week3.integration.test.ts`.
- [done] hardening note: Week 3 backend reliability hardening delivered (deterministic test DB migration/verification scripts, serialized CI test orchestration with DB-heavy Vitest file parallelism disabled, local troubleshooting runbook updates, and CI exclusion of `apps/web/auth.credentials.test.ts` due known NextAuth `next/server` resolver mismatch in Vitest).

### Week 4: LLM enrichment

#### You:

- [done] cached YouTube context model
- [done] LLM enrichment service
- [done] enrichment jobs
- [done] stale/missing enrichment policy
- [done] error persistence and retry policy
- [done] quota-conscious YouTube fetch logic

#### Marin:

- [done] enrichment status UI
- [done] row-level enrichment visibility
- [done] batch enrich actions
- [done] better job feedback in runs and channel detail

Done when:

- [done] manager can enrich from UI
- [done] errors are visible
- [done] repeated enrich does not re-fetch wastefully
- phased delivery note: Week 4 backend foundation is delivered end-to-end via `POST /api/channels/:id/enrich`, additive enrichment state on `GET /api/channels` and `GET /api/channels/:id`, cached YouTube context reuse/refresh, OpenAI-backed worker execution, persisted `queued/running/completed/failed/stale` lifecycle, and visible `last_error`; Marin Week 4 UI is now complete across catalog, runs, and channel detail.
- evidence note: backend coverage lives in `packages/core/src/week4.integration.test.ts`, `apps/web/app/api/week4.integration.test.ts`, and `apps/worker/src/channels-enrich-llm-worker.test.ts`.
- [done] evidence note: channel detail enrichment UI now ships on `/catalog/[channelId]` with request/retry/refresh actions backed by `POST /api/channels/:id/enrich`, automatic polling for `queued/running` states, preserved last successful enrichment content during refresh, and focused coverage in `apps/web/lib/channels-api.test.ts`, `apps/web/components/catalog/channel-detail-shell.test.ts`, and `apps/web/components/catalog/channel-detail-shell.behavior.test.ts`.
- [done] evidence note: catalog row-level enrichment visibility now ships on `/catalog` with stacked per-row status context, timestamp/failure copy for completed/stale/failed rows, automatic polling while visible rows remain `queued` or `running`, and focused coverage in `apps/web/components/catalog/catalog-table-shell.test.ts` and `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`.
- [done] evidence note: catalog batch enrichment now ships on `/catalog` with selection-aware `Enrich selected` actions, aggregated queued/running/error feedback for the current bulk request, immediate visible-row status updates before the next poll, and focused coverage in `apps/web/lib/channels-api.test.ts`, `apps/web/components/catalog/catalog-table-shell.test.ts`, and `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`.
- [done] evidence note: runs and channel detail now surface dedicated Week 4 worker-feedback callouts on `/runs`, `/runs/[runId]`, and `/catalog/[channelId]`, including updated timestamp context for recent runs, clearer queued/running/completed/failed next-step guidance, explicit empty-snapshot feedback, preserved-result refresh messaging, and focused coverage in `apps/web/components/runs/recent-runs-shell.test.ts`, `apps/web/components/runs/run-detail-shell.test.ts`, `apps/web/components/catalog/channel-detail-shell.test.ts`, and `apps/web/components/catalog/channel-detail-shell.behavior.test.ts`.

### Week 5: HypeAuditor and admin workflows

#### You:

- [done] HypeAuditor adapter
- [done] advanced report request model
- [done] approval workflow backend
- [done] worker execution for approved requests
- [done] admin CSV import backend
- [done] import validation and row error reporting

#### Marin:

- [done] request HypeAuditor UI
- [done] approval queue UI
- [done] admin import screen
- [done] import result/error UI
- [done] admin dashboard first useful version

Done when:

- [done] managers can request advanced reports
- [done] admins can approve/reject
- [done] admins can import CSV and see row-level failures
- phased delivery note: Week 5 backend is delivered end-to-end via `POST /api/channels/:id/advanced-report-requests`, `GET /api/admin/dashboard`, `GET /api/admin/advanced-report-requests`, `GET /api/admin/advanced-report-requests/:id`, `POST /api/admin/advanced-report-requests/:id/approve`, `POST /api/admin/advanced-report-requests/:id/reject`, `POST /api/admin/csv-import-batches`, `GET /api/admin/csv-import-batches`, `GET /api/admin/csv-import-batches/:id`, queue/worker execution for approved HypeAuditor requests and CSV imports, persisted `pending_approval/approved/rejected/queued/running/completed/failed` and `queued/running/completed/failed` lifecycles with visible `last_error`, normalized audience/commercial insights on `GET /api/channels/:id`, admin-only raw payload inspection, strict-template CSV validation, row-level CSV import result persistence, and an aggregated admin dashboard summary for approvals/imports/user readiness.
- evidence note: backend coverage lives in `packages/core/src/week5.integration.test.ts`, `packages/core/src/week5-csv-import.integration.test.ts`, `apps/web/app/api/week5.integration.test.ts`, `apps/web/app/api/week5-csv-import.integration.test.ts`, `apps/worker/src/channels-enrich-hypeauditor-worker.test.ts`, `apps/worker/src/imports-csv-process-worker.test.ts`, `packages/integrations/src/hypeauditor/report.test.ts`, `packages/core/src/approvals/status.test.ts`, and `packages/contracts/src/csv-imports.test.ts`.
- [done] evidence note: HypeAuditor request UI now ships on `/catalog/[channelId]` with status-specific request and re-request actions backed by `POST /api/channels/:id/advanced-report-requests`, automatic polling for `pending_approval/approved/queued/running`, preserved visible audience insights while newer approval and worker steps complete, and focused coverage in `apps/web/lib/channels-api.test.ts`, `apps/web/components/catalog/channel-detail-shell.test.ts`, and `apps/web/components/catalog/channel-detail-shell.behavior.test.ts`.
- [done] evidence note: admin approval queue UI now ships on `/admin` with a pending-first request list backed by `GET /api/admin/advanced-report-requests`, status-filtered history, auto-selection and detail loading via `GET /api/admin/advanced-report-requests/:id`, non-optimistic approve/reject actions via `POST /api/admin/advanced-report-requests/:id/approve` and `POST /api/admin/advanced-report-requests/:id/reject`, admin-only raw payload inspection, and focused coverage in `apps/web/lib/admin-advanced-reports-api.test.ts`, `apps/web/components/admin/admin-advanced-report-queue.test.ts`, `apps/web/components/admin/admin-advanced-report-queue.behavior.test.ts`, and `apps/web/app/(authenticated)/admin/page.test.ts`.
- [done] evidence note: admin CSV imports now ship on `/admin/imports` with strict-template upload guidance sourced from shared contracts metadata, non-optimistic batch creation via `POST /api/admin/csv-import-batches`, newest-first history and auto-selection backed by `GET /api/admin/csv-import-batches`, paginated row-level result and exact error rendering via `GET /api/admin/csv-import-batches/:id`, automatic polling while selected or visible batches remain `queued` or `running`, and focused coverage in `apps/web/lib/admin-csv-imports-api.test.ts`, `apps/web/components/admin/admin-csv-import-manager.test.ts`, `apps/web/components/admin/admin-csv-import-manager.behavior.test.ts`, and `apps/web/app/(authenticated)/admin/imports/page.test.ts`.
- [done] evidence note: admin dashboard first useful version now ships on `/admin` above the full approval queue with overview cards for pending approvals, active HypeAuditor work, actionable CSV imports, and managers missing YouTube keys, three attention panels backed by `GET /api/admin/dashboard`, manual refresh plus actionable-state polling, and focused coverage in `packages/contracts/src/week5.test.ts`, `packages/core/src/week5-admin-dashboard.integration.test.ts`, `apps/web/app/api/week5-admin-dashboard.integration.test.ts`, `apps/web/lib/admin-dashboard-api.test.ts`, `apps/web/components/admin/admin-dashboard-shell.test.ts`, `apps/web/components/admin/admin-dashboard-shell.behavior.test.ts`, and `apps/web/app/(authenticated)/admin/page.test.ts`.

### Week 6: Export and HubSpot

#### You:

- [done] CSV export service
- [done] HubSpot push service
- [done] push batch model
- [done] HubSpot push retry/error handling
- [done] audit events for exports/pushes

#### Marin:

- [done] select creators for export/push
- [done] export UI
- [done] HubSpot push UI
- [done] batch result screens
- [done] polish admin dashboard

Done when:

- [done] managers can export selected creators
- [done] managers can push selected creators to HubSpot
- [done] failures are visible and auditable
- phased delivery note: Week 6 backend is now delivered end-to-end via `POST /api/csv-export-batches`, `GET /api/csv-export-batches`, `GET /api/csv-export-batches/:id`, `GET /api/csv-export-batches/:id/download`, `POST /api/hubspot-push-batches`, `GET /api/hubspot-push-batches`, and `GET /api/hubspot-push-batches/:id`, with user-owned CSV export and HubSpot push batches, selected-or-filtered export scope snapshots, selected-channel HubSpot scope snapshots, persisted `queued/running/completed/failed` batch lifecycles plus per-row HubSpot push results, visible `last_error`, DB-backed CSV artifact storage, audit events for export request/completion/failure/download and HubSpot push request/completion/failure, worker execution on `exports.csv.generate` and `hubspot.push.batch`, and contacts-only HubSpot upserts from resolved catalog data; Week 6 UI is now complete, including the polished admin dashboard hub.
- evidence note: Week 6 backend coverage now lives in `packages/contracts/src/csv-exports.test.ts`, `packages/contracts/src/hubspot-pushes.test.ts`, `packages/integrations/src/hubspot/contacts.test.ts`, `packages/core/src/hubspot/index.test.ts`, `packages/core/src/week6-csv-export.integration.test.ts`, `packages/core/src/week6-hubspot-push.integration.test.ts`, `apps/worker/src/exports-csv-generate-worker.test.ts`, `apps/worker/src/hubspot-push-batch-worker.test.ts`, `apps/web/app/api/week6-csv-export.integration.test.ts`, and `apps/web/app/api/week6-hubspot-push.integration.test.ts`.
- [done] evidence note: catalog selection for Week 6 now ships on `/catalog` with existing cross-page creator selection extended to `Export selected` and `Push selected to HubSpot`, selected-scope batch creation via `POST /api/csv-export-batches` and `POST /api/hubspot-push-batches`, inline latest-batch polling against `GET /api/csv-export-batches/:id` and `GET /api/hubspot-push-batches/:id`, completed CSV download via `GET /api/csv-export-batches/:id/download`, compact HubSpot row failure feedback, and focused coverage in `apps/web/lib/csv-export-batches-api.test.ts`, `apps/web/lib/hubspot-push-batches-api.test.ts`, `apps/web/components/catalog/catalog-table-shell.test.ts`, `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`, and `apps/web/app/(authenticated)/catalog/page.test.ts`.
- [done] evidence note: filtered CSV export UI now ships on `/exports` with URL-backed catalog query/status filters, filtered-scope batch creation via `POST /api/csv-export-batches`, newest-first export history via `GET /api/csv-export-batches`, automatic polling while export batches remain `queued` or `running`, and deep links back to `/catalog` for selected-export flow, with focused coverage in `apps/web/lib/csv-export-batches-api.test.ts`, `apps/web/components/exports/csv-export-manager.test.ts`, `apps/web/components/exports/csv-export-manager.behavior.test.ts`, `apps/web/app/(authenticated)/exports/page.test.ts`, `apps/web/lib/navigation.test.ts`, `apps/web/components/layout/app-navigation.test.ts`, and `apps/web/components/layout/authenticated-shell.test.ts`.
- [done] evidence note: HubSpot push UI now ships on `/hubspot` with newest-first push history via `GET /api/hubspot-push-batches`, URL-selected batch detail via `GET /api/hubspot-push-batches/:id`, retained list/detail refresh state while queued or running batches poll, row-level pushed/failed outcomes, and catalog deep links into the dedicated workspace, with focused coverage in `apps/web/lib/hubspot-push-batches-api.test.ts`, `apps/web/components/hubspot/hubspot-push-manager.test.ts`, `apps/web/components/hubspot/hubspot-push-manager.behavior.test.ts`, `apps/web/app/(authenticated)/hubspot/page.test.ts`, `apps/web/lib/navigation.test.ts`, `apps/web/components/layout/app-navigation.test.ts`, `apps/web/components/layout/authenticated-shell.test.ts`, and `apps/web/components/catalog/catalog-table-shell.test.ts`.
- [done] evidence note: dedicated batch result screens now ship on `/exports/[batchId]` and `/hubspot/[batchId]` with route-backed detail loading from `GET /api/csv-export-batches/:id` and `GET /api/hubspot-push-batches/:id`, automatic polling while `queued` or `running` batches remain active, stored export scope snapshots, persisted HubSpot row outcomes, and direct deep links from `/exports`, `/hubspot`, and `/catalog`, with focused coverage in `apps/web/components/exports/csv-export-batch-result-shell.test.ts`, `apps/web/components/exports/csv-export-batch-result-shell.behavior.test.ts`, `apps/web/components/hubspot/hubspot-push-batch-result-shell.test.ts`, `apps/web/components/hubspot/hubspot-push-batch-result-shell.behavior.test.ts`, `apps/web/app/(authenticated)/exports/[batchId]/page.test.ts`, `apps/web/app/(authenticated)/hubspot/[batchId]/page.test.ts`, `apps/web/components/exports/csv-export-manager.test.ts`, `apps/web/components/hubspot/hubspot-push-manager.test.ts`, and `apps/web/components/catalog/catalog-table-shell.test.ts`.
- [done] evidence note: admin dashboard polish now ships on `/admin` with a Week 6 operations hub header, persistent workspace shortcuts into `/admin/imports`, `/admin/users`, `/catalog`, `/exports`, `/hubspot`, and the in-page HypeAuditor queue, plus tightened overview card copy that keeps imports, follow-through, and manager-readiness states scannable even while the summary refreshes or errors, with focused coverage in `apps/web/components/admin/admin-dashboard-shell.test.ts`, `apps/web/components/admin/admin-dashboard-shell.behavior.test.ts`, and `apps/web/app/(authenticated)/admin/page.test.ts`.

### Week 7: Workspace metadata, HubSpot import readiness, and YouTube enrichment hardening

#### You:

- strengthen YouTube enrichment backend to persist `youtube_handle`, `youtube_url`, `youtube_average_views`, `youtube_engagement_rate`, and `youtube_followers`
- keep YouTube-derived averages and engagement best-effort and failure-visible when the API cannot provide enough recent video context

#### Marin:

- [done] land frontend workspace reorganization baseline (branch: `feat/ui-workspace-reorg`)
- [done] add a separate `user_type` model for `Admin`, `Campaign Manager`, `Campaign Lead`, and `HoC` while keeping the current admin-vs-standard permission split intact
- [done] set existing users to `Campaign Manager` by default and keep legacy Week 6 runs rendering safely after the migration
- [done] extend run metadata persistence with dashboard and HubSpot-import fields: `client`, `market`, `campaign_manager_user_id`, `brief_link`, `campaign_name`, `month`, `year`, `deal_owner`, `deal_name`, `pipeline`, `deal_stage`, `currency`, `deal_type`, `activation_type`
- [done] update run queries/contracts so Dashboard, Database, CSV export, and HubSpot flows can read and filter by the new run metadata
- [done] expose campaign manager options from users whose `user_type` is `Campaign Manager`
- [done] replace the planned New Scouting metadata scaffold with live fields for client, market, campaign manager, brief link, campaign name, month, year, deal owner, deal name, pipeline, deal stage, currency, deal type, and activation type
- [done] remove `Week` from New Scouting and from the Dashboard workspace
- [done] rebuild the Dashboard table with functional columns: `Client`, `Market`, `Campaign Manager`, `Brief Link`, `Influencer List`, `Coverage`, `Actions`
- [done] add Dashboard filters at the top for `Campaign Manager`, `Client`, and `Market`
- [done] make `Coverage` a visual progress line plus written percentage/result copy
- [done] update the Database table so these columns are available: `Channel`, `YouTube Handle`, `YouTube URL`, `YouTube Average Views`, `YouTube Engagement Rate`, `YouTube Followers`
- [done] own the HubSpot import workflow end-to-end in Week 7, including backend batch shaping and frontend validation/history updates
- [done] make every run exportable into a HubSpot-importable schema with these required properties: `Contact Type`, `Campaign Name`, `Month`, `Year`, `Client name`, `Deal owner`, `Deal name`, `Pipeline`, `Deal stage`, `Currency`, `Deal Type`, `Activation Type`, `First Name`, `Last Name`, `Email`, `Influencer Type`, `Influencer Vertical`, `Country/Region`, `Language`
- [done] surface missing-field blockers before a HubSpot import batch/export is created and keep per-row failures visible for retry/debugging
- Evidence: migration `20260316113000_week7_workspace_metadata_hubspot_import`; routes `/api/users/campaign-managers` and `/api/hubspot-import-batches*`; UI in New Scouting, Dashboard, Database, HubSpot, and admin user management; targeted tests in `apps/web`, `packages/core`, and `apps/worker`.

#### Both:

- keep the milestone scoped to stronger run logic, richer YouTube enrichment, and HubSpot import readiness only
- align the final HubSpot property labels once before implementation so exports, UI copy, and worker payloads do not drift
- review the migration/backfill plan together before merging any Prisma migration
- preserve admin-only routes and audit coverage exactly as-is even with the new `user_type` metadata

Implementation map:

- `packages/db/prisma/schema.prisma` plus a new Prisma migration for `user_type`, run metadata, and the new YouTube metric fields
- `packages/contracts/src/auth.ts`, `packages/contracts/src/admin.ts`, run contracts, channel contracts, and HubSpot/export contracts carrying the new fields
- `packages/core/src/auth/*`, `packages/core/src/runs/*`, `packages/core/src/channels/*`, `packages/core/src/hubspot/*`, and related repositories/services for metadata persistence, filtering, mapping, and validation
- `packages/integrations/src/youtube/*` for channel-level YouTube enrichment field capture and derived metric logic
- `apps/web/components/scouting/*`, `apps/web/components/dashboard/*`, `apps/web/components/database/*`, `apps/web/components/hubspot/*`, matching route handlers, and their tests

Test matrix:

- unit: user-type normalization, HubSpot field mapping, coverage-percent formatting, and YouTube derived-metric calculations
- integration: migrations, run create/list/detail with new metadata, dashboard filtering by campaign manager/client/market, campaign-manager-only selectors, and HubSpot batch validation failures
- integration: enrichment persistence for `youtube_handle`, `youtube_url`, `youtube_average_views`, `youtube_engagement_rate`, and `youtube_followers`, including partial-data and retry/error cases
- frontend/component: New Scouting field removal for `Week`, Dashboard table/filter behavior, Coverage progress rendering, Database columns, and HubSpot missing-field warnings
- Playwright: create a run with the new metadata, filter it from Dashboard, open its influencer list, and start an export/HubSpot import flow from the run

Risk / rollback notes:

- YouTube does not expose canonical channel-level average-view or engagement-rate fields, so Week 7 should treat them as derived metrics from fetched video context rather than guaranteed raw provider fields
- existing Week 6 HubSpot batches and runs must remain readable after the migration; favor additive columns and safe defaults over destructive reshaping
- if the HubSpot property contract slips, hold batch creation behind validation rather than creating partially importable files

Done when:

- New Scouting stores the new campaign metadata, no longer shows `Week`, and only offers campaign managers from `user_type = Campaign Manager`
- Dashboard filters runs by campaign manager, client, and market, and the table shows functional `Client`, `Market`, `Campaign Manager`, `Brief Link`, `Influencer List`, `Coverage`, and `Actions` columns
- each run can produce a HubSpot-importable export/batch containing the full Week 7 property schema
- Database exposes the new YouTube columns and channel enrichment can populate them without breaking existing catalog views
- non-admin user types still behave like normal users, admins still keep admin rights, existing users default to `Campaign Manager`, and legacy runs/users still load safely

Handoff checklist:

- feature-agent: land schema/contracts/core/web changes in the order `user_type + run metadata` -> `dashboard/new scouting` -> `HubSpot import mapping` -> `YouTube enrichment + database columns`
- test-agent: add regression coverage for migration compatibility, HubSpot property completeness, and partial YouTube enrichment data
- review-agent: focus on auth-model drift, precedence regressions, and whether HubSpot validation blocks bad imports early enough

### Week 8: Stabilization

#### You:

- DB/index tuning
- job concurrency tuning
- staging load smoke
- deploy/rollback docs
- backup/restore drill

#### Marin:

- Playwright coverage for critical flows
- accessibility cleanup
- edge-case UI fixes
- empty/loading/error state pass

#### Both:

- fix bugs only
- no scope expansion
- production checklist
- launch

## Full CI from day one

Require on every PR:

- typecheck
- lint
- Prisma validate
- unit tests
- integration tests with ephemeral Postgres
- web build
- worker build
- Playwright smoke tests

## Protected `main` rules:

- passing CI required
- one approval required
- no direct pushes
- migrations require review from the other person
