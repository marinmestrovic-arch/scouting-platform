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

Done when:

- [done] repo built
- [done] CI running
- [done] staging deploy path existed (repo is deploy-ready; follow `/docs/setup/staging-railway.md` for manual provisioning checklist)
- [done] auth shell existed
- [done] no feature code yet

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

### Week 7: Workspace metadata, HubSpot import readiness, and YouTube enrichment hardening

#### You:

- [done] strengthen YouTube enrichment to persist handle, URL, average views, engagement rate, and followers
- [done] keep derived metrics best-effort and failure-visible

#### Marin:

- [done] frontend workspace reorganization baseline
- [done] `user_type` model: Admin, Campaign Manager, Campaign Lead, HoC
- [done] backfill existing users to Campaign Manager; legacy runs render safely
- [done] run metadata fields: client, market, campaign manager, brief link, campaign name, month, year, deal owner, deal name, pipeline, deal stage, currency, deal type, activation type
- [done] run queries/contracts updated for Dashboard, Database, CSV export, and HubSpot
- [done] campaign manager selector from `user_type = Campaign Manager` users
- [done] New Scouting: live metadata fields, remove Week
- [done] Dashboard: Client/Market/Campaign Manager/Brief Link/Influencer List/Coverage/Actions columns and filters
- [done] Coverage: visual progress line with percentage/result copy
- [done] Database: YouTube Handle/URL/Average Views/Engagement Rate/Followers columns
- [done] HubSpot import workflow end-to-end (backend + frontend)
- [done] run exportable to HubSpot-importable schema with full property set
- [done] missing-field blockers before batch creation; per-row failures visible

Done when:

- [done] New Scouting has campaign metadata, no Week, campaign-manager-only selector
- [done] Dashboard filters and table columns functional
- [done] runs produce valid HubSpot import batches
- [done] Database shows YouTube enrichment columns

### Week 8: Stabilization

#### You:

- [done] establish Week 8 as launch-hardening only and defer follow-on feature plans in `/docs/plans`
- [done] tighten staging deploy/rollback guidance in `/docs/setup/staging-railway.md`
- [done] add a concrete Postgres backup/restore drill runbook in `/docs/setup/postgres-backup-restore-drill.md`
- [done] add a launch-readiness checklist in `/docs/setup/launch-readiness.md`
- [done] verify and document queue worker concurrency + atomic claim expectations
- [done] DB/index tuning
- staging load smoke in the real staging environment
- [done] backup/restore drill execution against a production-like local Postgres restore target
- production checklist sign-off

#### Marin:

- [done] expand Playwright smoke beyond the anonymous homepage baseline
- [done] Playwright coverage for critical signed-in flows
- [done] accessibility cleanup
- [done] edge-case UI fixes
- [done] empty/loading/error state pass

#### Both:

- [done] fix bugs only
- [done] no scope expansion
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
