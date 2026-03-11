# Tasks

## Work split

This split is by ownership surface, not skill hierarchy.

### You own:

- DB schema and migrations
- auth backend and session model
- queue/worker architecture
- external integrations
- run orchestration
- enrichment pipeline
- Hype approval backend
- CSV import backend
- HubSpot backend
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
- HubSpot push UI
- Playwright e2e coverage

### Both of you:

- pair on schema and ADR decisions
- review every PR
- pair on final integration of each milestone
- never merge a Prisma migration without both reviewing it

## Milestone plan

Assuming 30h/week each, this is a realistic 6 to 7 week build.

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
- batch enrich actions
- better job feedback in runs and channel detail

Done when:

- manager can enrich from UI
- errors are visible
- repeated enrich does not re-fetch wastefully
- phased delivery note: Week 4 backend foundation is delivered end-to-end via `POST /api/channels/:id/enrich`, additive enrichment state on `GET /api/channels` and `GET /api/channels/:id`, cached YouTube context reuse/refresh, OpenAI-backed worker execution, persisted `queued/running/completed/failed/stale` lifecycle, and visible `last_error`; Marin Week 4 UI items remain open.
- evidence note: backend coverage lives in `packages/core/src/week4.integration.test.ts`, `apps/web/app/api/week4.integration.test.ts`, and `apps/worker/src/channels-enrich-llm-worker.test.ts`.
- [done] evidence note: channel detail enrichment UI now ships on `/catalog/[channelId]` with request/retry/refresh actions backed by `POST /api/channels/:id/enrich`, automatic polling for `queued/running` states, preserved last successful enrichment content during refresh, and focused coverage in `apps/web/lib/channels-api.test.ts`, `apps/web/components/catalog/channel-detail-shell.test.ts`, and `apps/web/components/catalog/channel-detail-shell.behavior.test.ts`.
- [done] evidence note: catalog row-level enrichment visibility now ships on `/catalog` with stacked per-row status context, timestamp/failure copy for completed/stale/failed rows, automatic polling while visible rows remain `queued` or `running`, and focused coverage in `apps/web/components/catalog/catalog-table-shell.test.ts` and `apps/web/components/catalog/catalog-table-shell.behavior.test.ts`.

### Week 5: HypeAuditor and admin workflows

#### You:

- [done] HypeAuditor adapter
- [done] advanced report request model
- [done] approval workflow backend
- [done] worker execution for approved requests
- [done] admin CSV import backend
- [done] import validation and row error reporting

#### Marin:

- request HypeAuditor UI
- approval queue UI
- admin import screen
- import result/error UI
- admin dashboard first useful version

Done when:

- managers can request advanced reports
- admins can approve/reject
- admins can import CSV and see row-level failures
- phased delivery note: Week 5 backend is delivered end-to-end via `POST /api/channels/:id/advanced-report-requests`, `GET /api/admin/advanced-report-requests`, `GET /api/admin/advanced-report-requests/:id`, `POST /api/admin/advanced-report-requests/:id/approve`, `POST /api/admin/advanced-report-requests/:id/reject`, `POST /api/admin/csv-import-batches`, `GET /api/admin/csv-import-batches`, `GET /api/admin/csv-import-batches/:id`, queue/worker execution for approved HypeAuditor requests and CSV imports, persisted `pending_approval/approved/rejected/queued/running/completed/failed` and `queued/running/completed/failed` lifecycles with visible `last_error`, normalized audience/commercial insights on `GET /api/channels/:id`, admin-only raw payload inspection, strict-template CSV validation, and row-level CSV import result persistence.
- evidence note: backend coverage lives in `packages/core/src/week5.integration.test.ts`, `packages/core/src/week5-csv-import.integration.test.ts`, `apps/web/app/api/week5.integration.test.ts`, `apps/web/app/api/week5-csv-import.integration.test.ts`, `apps/worker/src/channels-enrich-hypeauditor-worker.test.ts`, `apps/worker/src/imports-csv-process-worker.test.ts`, `packages/integrations/src/hypeauditor/report.test.ts`, `packages/core/src/approvals/status.test.ts`, and `packages/contracts/src/csv-imports.test.ts`.

### Week 6: Export and HubSpot

#### You:

- CSV export service
- HubSpot push service
- push batch model
- push retry/error handling
- audit events for exports/pushes

#### Marin:

- select creators for export/push
- export UI
- HubSpot push UI
- batch result screens
- polish admin dashboard

Done when:

- managers can export selected creators
- managers can push selected creators to HubSpot
- failures are visible and auditable

### Week 7: Stabilization

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
