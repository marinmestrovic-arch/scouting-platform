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

##### Plan: channel detail shell

- Scope: replace the `/catalog/[channelId]` Week 0 placeholder with a real Week 1 shell that is safe for authenticated users to open before Week 2 live detail data lands.
- In scope: authenticated route guard parity with other catalog/admin pages, route param handling for `channelId`, visible detail-page scaffold, navigation back to catalog, stable placeholder sections for identity/metadata/enrichment, and copy that clearly defers live data/editing to later milestones.
- Out of scope: fetching `GET /api/channels/:id`, rendering live channel fields, enrichment actions, manual edit UX, admin-only controls, polling, or any Week 2 detail behavior.
- File change map: update `apps/web/app/(authenticated)/catalog/[channelId]/page.tsx`; add a dedicated presentational shell component under `apps/web/components/catalog/`; add or update page/component tests beside those files; touch `apps/web/app/globals.css` only if existing shell primitives cannot cover the layout.
- Implementation sequence: 1. mirror the route protection used by authenticated pages; 2. add a reusable `ChannelDetailShell` component with placeholder cards/rows; 3. wire the page to pass the `channelId` into breadcrumb/back-link copy or shell metadata without implying live fetch; 4. keep markup accessible and responsive using existing page-section/layout conventions; 5. replace the placeholder test with assertions for the new shell structure.
- Test matrix: happy path server render for authenticated route shell; regression coverage that the old Week 0 placeholder copy is gone; shell shows a back link to `/catalog`; shell exposes channel-specific context from route params without fetching data; optional component test for visible placeholder sections and CTA labels.
- Risks: accidentally coupling Week 1 shell to the already-available detail API and pulling Week 2 scope forward; introducing a one-off layout instead of reusing current shell patterns; ambiguous placeholder copy that confuses users about what is functional today.
- Rollback: revert the page/component to the previous placeholder and keep tests aligned; no schema or backend changes are involved.
- Done criteria: authenticated users can open `/catalog/[channelId]` and see a clear, structured shell; route remains safe without backend data; tests cover the route and shell copy/structure; no API or schema changes are introduced.
- Feature-agent handoff: implement only the UI shell on branch `feat/week1-channel-detail-shell` in worktree `.worktrees/feature-agent-feat-week1-channel-detail-shell`; reuse existing page-section/auth patterns; do not call the channel detail API yet.
- Test-agent handoff: strengthen page/component coverage around auth-safe render, back navigation, placeholder sections, and route-param-derived context; avoid backend/integration scope unless the implementation introduces it.
- Review-agent handoff: verify Week 1/Week 2 boundary discipline, route guard consistency, accessible semantics, and that tests meaningfully prevent accidental live-data coupling.

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
- phased delivery note: segment persistence backend is delivered as personal saved filter segments CRUD; remaining Week 2 items stay open

### Week 3: Runs and discovery

#### You:

- [done] run request model (phase 1: run request lifecycle persistence in `run_requests`)
- [done] run execution service (phase 1: queued -> running -> completed/failed transitions with persisted `last_error`)
- [done] YouTube discovery adapter using per-user key
- [done] dedupe/union with catalog
- [done] run result snapshot model (phase 1: `run_results` snapshot rows with rank/source)
- [done] background job for discovery (phase 1: `runs.discover` queue + worker execution wiring)

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
- phased delivery note: Week 3 backend is delivered end-to-end (`POST /api/runs`, `GET /api/runs/:id`, queue/worker lifecycle, per-user-key YouTube discovery, deduped catalog+discovery union ranking, and snapshot persistence); Marin Week 3 UI items remain open.
- hardening note: Week 3 backend reliability hardening delivered (deterministic test DB migration/verification scripts, serialized CI test orchestration with DB-heavy Vitest file parallelism disabled, local troubleshooting runbook updates, and CI exclusion of `apps/web/auth.credentials.test.ts` due known NextAuth `next/server` resolver mismatch in Vitest).

### Week 4: LLM enrichment

#### You:

- [done] cached YouTube context model
- [done] LLM enrichment service
- [done] enrichment jobs
- [done] stale/missing enrichment policy
- [done] error persistence and retry policy
- [done] quota-conscious YouTube fetch logic

#### Marin:

- enrichment status UI
- row-level enrichment visibility
- batch enrich actions
- better job feedback in runs and channel detail

Done when:

- manager can enrich from UI
- errors are visible
- repeated enrich does not re-fetch wastefully
- phased delivery note: Week 4 backend foundation is delivered end-to-end via `POST /api/channels/:id/enrich`, additive enrichment state on `GET /api/channels` and `GET /api/channels/:id`, cached YouTube context reuse/refresh, OpenAI-backed worker execution, persisted `queued/running/completed/failed/stale` lifecycle, and visible `last_error`; Marin Week 4 UI items remain open.
- evidence note: backend coverage lives in `packages/core/src/week4.integration.test.ts`, `apps/web/app/api/week4.integration.test.ts`, and `apps/worker/src/channels-enrich-llm-worker.test.ts`.

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
