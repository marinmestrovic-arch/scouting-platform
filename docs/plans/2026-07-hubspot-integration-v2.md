# HubSpot Integration V2 Implementation Plan

- Status: Completed
- Date: 2026-07-20
- Branch: `codex/hubspot-integration-v2`
- Governing decision: [`ADR-005`](../ADR-005-hubspot-integration-boundaries.md)

## Objective

Replace the dual legacy-push/import-ready-CSV model with one run-scoped, durable direct-sync workflow while preserving CSV fallback, historical batches, ADR-002 precedence, and safe single-portal rollout controls.

## Delivery sequence

1. Add centralized token/config validation, current `2026-03` adapters, batch upsert, association discovery/creation, owner/pipeline/property discovery, response validation, retry/backoff, correlation capture, and signature validation.
2. Add an additive Prisma migration for portal identity, contact/deal links, delivery state, internal reference values, owners, pipelines/stages, associations, webhook events, sync cursors, and conflicts. Update cleanup/migration-safety fixtures.
3. Replace destructive object reconciliation with explicit archive handling, incremental high-water marks, overlap prevention, warning counts, and `Europe/Zagreb` scheduling.
4. Add the read-only health service, admin route/panel, safe user readiness response, and portal provisioning blockers.
5. Upgrade `HubspotImportBatch` into a resumable Object API state machine: prepare, submit deal/contacts, associate, finish/partial-finish; persist returned IDs and retry only failed rows. Preserve CSV download.
6. Remove the legacy contact-only action from active product paths while retaining compatibility history/routes. Consolidate terminology around “Sync to HubSpot” and “Download HubSpot CSV.”
7. Add the signature-authenticated webhook route, deduplicated persistence, thin worker, timestamp-aware processing, safe merge/archive behavior, and conflict recording/listing.
8. Add `/hubspot-app` with private/static `2026.03` app configuration, contact/deal cards, signed context endpoint, local tests, and deployment/setup instructions. Do not upload or install it.
9. Update living architecture/product/evaluation docs, environment examples, local/staging/Dokku guidance, provisioning, rollout, rollback, token rotation, webhook, and queue documentation.
10. Run targeted package checks, Prisma validation/generation/migration safety, the broad test/lint/typecheck/build suite, and Playwright smoke where the local environment permits.

## Rollout guardrails

- `HUBSPOT_DIRECT_SYNC_ENABLED` and `HUBSPOT_WEBHOOKS_ENABLED` default off.
- No health check mutates HubSpot schema.
- No automated test makes a live HubSpot request.
- Empty/unknown values are omitted from outbound payloads.
- Direct sync is blocked until portal identity, required unique properties, object mappings, internal references, and association definitions are valid.
- Schema/code deploy before feature enablement; UI-extension upload/install is a separate portal-side operation.
- The Prisma migration must be reviewed by both owners before merge.

## Verification record

- `pnpm db:validate && pnpm db:generate` — passed; Prisma schema validated and Prisma Client generated.
- `pnpm db:migrate:test` — passed; all 39 migrations applied to the test database with no pending migration.
- `sh scripts/with-local-env.sh pnpm test` — passed across all 7 packages: 205 test files and 1,069 tests. This includes the automated pre-V2-to-V2 migration preservation test, provider-adapter mocks, direct-sync phase/retry durability, object-sync and portal execution fencing, queued health-check and delivery recovery, generic/classic webhook ordering and idempotency, UI-extension ownership, authenticated routes, and worker handlers.
- `pnpm typecheck` — passed in all 7 packages.
- `pnpm lint` — passed in all 6 packages that define a lint task.
- `sh scripts/with-local-env.sh pnpm build` — passed in all 6 build targets, including the production Next.js build. Existing unrelated React hook/accessibility warnings remain non-fatal.
- `sh scripts/with-local-env.sh pnpm --filter @scouting-platform/web test:smoke` — passed all 9 Playwright tests, including mocked direct HubSpot and database object-sync flows.
- All final verification gates ran with HubSpot and other provider credentials explicitly blanked. Earlier, a focused adapter command exposed a legacy test-isolation gap: one authenticated HubSpot schema read succeeded and one contact PATCH attempt returned a provider error. The affected tests now clear both supported HubSpot token variables before each run. No successful portal write was observed; the app was not deployed and no rollout feature flag was enabled.
- The local shell used Node.js `25.7.0`, so pnpm emitted the repository engine warning for the supported Node.js `>=22 <23` range. All checks above still completed successfully; release verification should use Node.js 22.
