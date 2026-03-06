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

Done when:

- repo builds
- CI runs
- staging deploy exists (repo is deploy-ready; follow `/docs/setup/staging-railway.md` for manual provisioning checklist)
- auth shell exists
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

- login screen
- admin user management UI
- account detail UI for user YouTube credential state
- catalog table shell
- channel detail shell

Done when:

- admin can create a user
- admin can assign/update YouTube key
- user can log in
- empty catalog pages load safely

### Week 2: Catalog browsing, segments, manual edit

#### You:

- [done] channel list/detail queries
- [done] segment persistence (phase 1: personal saved filter segments CRUD)
- [done] manual override model and merge logic (phase 2: per-field channel overrides with precedence-safe fallback restore)
- [done] audit events for edits (phase 2: admin channel override patches)

#### Marin:

- catalog filters
- channel detail page
- saved segments UX
- admin manual edit UI
- row selection UX

Done when:

- catalog list/detail works
- segments save/load
- admin manual edits persist and override automated values
- evidence note: backend catalog queries are live via `GET /api/channels` and `GET /api/channels/:id` with integration coverage in `apps/web/app/api/week1.integration.test.ts`
- phased delivery note: segment persistence backend is delivered as personal saved filter segments CRUD
- phased delivery note: manual override backend + audit events for admin edits are delivered; Marin UI integration remains

### Week 3: Runs and discovery

#### You:

- run request model
- run execution service
- YouTube discovery adapter using per-user key
- dedupe/union with catalog
- run result snapshot model
- background job for discovery

#### Marin:

- create run UI
- recent runs UI
- run detail UI
- progress/status polling
- clear error states for missing YouTube key or quota failure

Done when:

- manager can create a run
- run uses both catalog and new discovery
- results are saved and viewable

### Week 4: LLM enrichment

#### You:

- cached YouTube context model
- LLM enrichment service
- enrichment jobs
- stale/missing enrichment policy
- error persistence and retry policy
- quota-conscious YouTube fetch logic

#### Marin:

- enrichment status UI
- row-level enrichment visibility
- batch enrich actions
- better job feedback in runs and channel detail

Done when:

- manager can enrich from UI
- errors are visible
- repeated enrich does not re-fetch wastefully

### Week 5: HypeAuditor and admin workflows

#### You:

- HypeAuditor adapter
- advanced report request model
- approval workflow backend
- worker execution for approved requests
- admin CSV import backend
- import validation and row error reporting

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
