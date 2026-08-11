# Codex Implementation Guide: Link Almedia Enrichments to the Channel Catalog

- Status: Deferred
- Date: 2026-08-11
- Owner: Ivan

## Context

The Almedia workspace stores its own creator enrichments (`almedia_channel_enrichments`,
produced by the standalone tracker's enrichment service) while the platform has a separate
LLM enrichment pipeline (`channel_enrichments` on catalog `channels`). This plan is the
first increment of merging the two systems: give every Almedia enrichment a foreign key to
its catalog channel, backfilled by exact YouTube channel id match.

Decisions already made (do not re-litigate):

- **Increment one is FK + backfill**, not query-time joins and not provider registration.
- **Long term, the platform enrichment pipeline is the system of record**; the tracker
  document becomes supplementary. This increment only creates the link — no data merging.
- Vocabulary reconciliation (platform's 23-niche enum vs the workspace's 77 verticals) is
  explicitly out of scope.

Measured against production on 2026-08-11:

- 318 Almedia enrichments (local DB; the table is not in prod yet — see Preconditions).
- 248 of 318 (78%) match a row in prod `channels` on YouTube channel id, out of 71,905
  catalog channels. All 248 already have a completed platform enrichment with a
  `structured_profile`.
- 70 creators (22%) are not in the catalog. Ingesting them is a follow-up increment
  (see Out of scope). The FK stays `NULL` for them; nothing may break on `NULL`.

Identity join is exact-string, no fuzzy matching: `channels.youtube_channel_id` is
`@unique` (schema line ~622) and `almedia_channel_enrichments.channel_id` is the raw
YouTube channel id, also `@unique` (schema line ~1864). The mapping is 1:1.

## Preconditions

1. The currently uncommitted Almedia changeset on `dev` (enrichments store, migration
   `20260810205429_almedia_channel_enrichments`, insights panel, invoices, contracts
   changes) **must be committed first**. This plan's migration builds on that one.
   If the working tree is already clean when you start, this is done.
2. Deploy order note for whoever ships this: prod does not have the
   `almedia_channel_enrichments` table yet. Both migrations (the pending one above, then
   this plan's) deploy together via the normal `db:migrate:deploy` step; the backfill
   below will simply link 0 rows on a fresh prod table and the write-time linking in
   Task 2 takes over from the first tracker import.

## Naming rule (applies to every task)

In the `almedia_*` table family, `channelId` / `channel_id` already means **YouTube
channel id** (e.g. `UChoZqpn_fLmoExx2g4KL58A`). The new column linking to the catalog
must be named `catalogChannelId` / `catalog_channel_id` everywhere — Prisma model,
SQL, contracts, core, and frontend. Never overload `channelId`.

## Task 1: Schema migration — `catalog_channel_id` FK plus backfill

**Files:** `backend/packages/db/prisma/schema.prisma`, new migration directory under
`backend/packages/db/prisma/migrations/`.

1. On `model AlmediaChannelEnrichment` add:

   ```prisma
   /// Catalog channel this creator resolves to, matched on YouTube channel id.
   /// Null when the creator is not (yet) in the catalog.
   catalogChannelId String?  @map("catalog_channel_id") @db.Uuid
   catalogChannel   Channel? @relation(fields: [catalogChannelId], references: [id], onDelete: SetNull)

   @@index([catalogChannelId], map: "almedia_channel_enrichments_catalog_channel_id_idx")
   ```

   Add the corresponding back-relation on `model Channel` (Prisma requires it; a plain
   list field like `almediaEnrichments AlmediaChannelEnrichment[]` is fine).

   `onDelete: SetNull` is deliberate: deleting a catalog channel must not delete the
   tracker's enrichment. Do not use a unique constraint — the 1:1 property is already
   guaranteed by the two `@unique` YouTube-id columns.

2. Generate the migration with the repo's normal Prisma migration flow, then append the
   backfill to the generated `migration.sql` so schema change and backfill ship as one
   unit:

   ```sql
   UPDATE almedia_channel_enrichments a
   SET catalog_channel_id = c.id
   FROM channels c
   WHERE c.youtube_channel_id = a.channel_id
     AND a.catalog_channel_id IS NULL;
   ```

   This is idempotent and re-runnable; on an empty table it is a no-op.

## Task 2: Link at write time in the tracker import

**File:** `backend/packages/core/src/almedia/import-sqlite.ts`

The enrichment upsert (currently around line 289, `tx.almediaChannelEnrichment.upsert`)
must set `catalogChannelId` on both `create` and `update`.

Resolve efficiently: before the per-row loop, collect every `channel_id` from the
enrichment rows and fetch matching catalog channels in **one query**
(`tx.channel.findMany({ where: { youtubeChannelId: { in: ids } }, select: { id: true, youtubeChannelId: true } })`),
build a `Map<string, string>` of YouTube id → catalog UUID, and look up per row. Do not
query per row.

A YouTube id with no catalog match sets `catalogChannelId: null` — including on
`update`, so a stale link from a since-deleted channel does not survive a re-import
(`SetNull` already covers deletion; this covers consistency).

Extend `backend/packages/core/src/almedia/import-sqlite.integration.test.ts`: seed one
catalog channel whose `youtubeChannelId` matches an imported enrichment and one
enrichment with no catalog match; assert the first gets linked and the second stays
`NULL`.

## Task 3: Re-link pass for channels created after import

Creators enter the catalog continuously (discovery, CSV import). A channel created after
the last tracker import must eventually pick up its link without waiting for the next
import.

**File:** `backend/packages/core/src/almedia/enrichments.ts`

Add and export:

```ts
/** Link enrichments to catalog channels that appeared since the last import. Idempotent. */
export async function relinkAlmediaEnrichmentCatalogChannels(): Promise<number>
```

Implementation: a single set-based statement (`prisma.$executeRaw` with the same
`UPDATE ... FROM` as the migration backfill) returning the number of rows linked. The
table is a few hundred rows; one statement, no batching.

**Call site:** the hourly Almedia campaigns sync job
(`backend/worker/src/almedia-campaigns-sync-worker.ts`) — run the re-link at the start of
each sync run. Follow the worker's existing logging pattern; log the linked count only
when it is greater than 0.

Unit-test the function following the existing test style in this directory (see
`deals.test.ts` for how prisma is mocked/faked here).

## Task 4: Expose the link through contracts and the deal join

**Files:** `shared/packages/contracts/src/almedia.ts`,
`backend/packages/core/src/almedia/enrichments.ts`,
`backend/packages/core/src/almedia/deals.ts`.

1. Contracts: add `catalogChannelId: z.string().nullable()` to `almediaDealSchema`. Note
   this field rides on the deal row, **not** inside `almediaChannelEnrichmentSchema` —
   that schema is a projection of the tracker's document and the tracker knows nothing
   about catalog UUIDs.
2. `enrichments.ts`: the lookup currently maps link keys to the parsed enrichment
   document. Extend the map value so the catalog id travels with it, e.g.
   `{ enrichment: AlmediaChannelEnrichment; catalogChannelId: string | null }` (adjust
   `AlmediaEnrichmentLookup`, `findCampaignEnrichment`, `findChannelEnrichment`, and
   `loadAlmediaEnrichmentLookup` — the `findMany` already selects `channelId`; add
   `catalogChannelId`).
3. `deals.ts`: thread `catalogChannelId` from the resolved enrichment onto each deal
   (both the campaign-joined path around line 273 and the booking-only path around
   line 283). Deals with no enrichment get `null`.
4. Update `shared/packages/contracts/src/almedia.test.ts` and
   `backend/packages/core/src/almedia/deals.test.ts` for the new field.

## Task 5: Cross-navigation in the workspace UI

**Files:** the deal/creator tables under `frontend/web/components/almedia/`
(`almedia-performance-tab.tsx`, `almedia-bookings-tab.tsx` — locate where
`channelName` renders), `frontend/web/lib/almedia/types.ts` if it mirrors the deal type.

Where a creator's name renders and the deal has a non-null `catalogChannelId`, render it
as a Next.js `<Link>` to `/catalog/{catalogChannelId}` (the existing channel detail
route — the param is the catalog UUID, see
`frontend/web/app/(authenticated)/catalog/[channelId]/page.tsx`). With `null`, keep the
current plain-text rendering — no dead links, no placeholder.

Match the existing link styling used elsewhere in the workspace (e.g. how `videoUrl`
links render) rather than inventing a new style. Update
`almedia-tabs.render.test.ts` / `almedia-workspace.behavior.test.ts` following their
existing markup-pinning approach: one case with a linked creator, one without.

## Verification

1. `pnpm --filter @scouting-platform/db` migration applies cleanly on the local database
   (local DB: `postgresql://scouting:scouting@localhost:5432/scouting_platform`, psql at
   `/opt/homebrew/opt/postgresql@16/bin/psql`; dev commands run through
   `scripts/with-local-env.sh`).
2. `pnpm --filter @scouting-platform/core test` — import integration test, enrichments
   lookup tests, deals tests.
3. `pnpm --filter @scouting-platform/contracts test`.
4. `pnpm --filter @scouting-platform/web test`.
5. Local smoke: after a tracker import against the local DB, spot-check
   `SELECT count(*) FROM almedia_channel_enrichments WHERE catalog_channel_id IS NOT NULL;`
   (local `channels` may be sparsely populated; 0 links locally is acceptable — the
   integration test is the real coverage).
6. Type check and lint per repo defaults (`pnpm tsc --noEmit`, eslint).

## Out of scope (follow-up increments, do not start)

- **Ingesting the 70 unmatched creators** into `channels` and queueing them for platform
  enrichment. Separate plan; depends on this one.
- Registering `ALMEDIA` as a `ChannelProviderPayloadProvider` / `ChannelInsightSource`.
- Vocabulary reconciliation between the platform niche enum and workspace verticals.
- Catalog-side surfacing ("booked N times, avg return") on the channel detail page —
  the FK enables it, but it is not part of this increment.
- Re-enriching Almedia creators through the platform pipeline to replace tracker
  documents (explicitly rejected: the platform's structured profile is closed enums, so
  the workspace's keyword-scored vertical derivation would lose its free-text input).
