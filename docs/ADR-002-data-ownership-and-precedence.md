# ADR-002: Catalog Canonical Model and Data Precedence

- Status: Accepted
- Date: 2026-03-04

## Context

The product must support:

- browsing already known creators from a shared database
- creating new scouting runs that use both existing catalog data and newly discovered channels
- importing contacts and metrics through admin CSV workflows
- enriching channels with heuristics, LLM output, and HypeAuditor reports
- manually editing channel data when automated sources are incomplete or wrong
- exporting and pushing selected creators to HubSpot

The previous system blurred the boundary between run data and catalog data. That made it harder to reason about source of truth, override behavior, and long-term maintainability.

## Decision

The channel catalog is the canonical product model. Runs are snapshots and orchestration artifacts, not the primary system of record.

### Canonical model

- `channels` stores the resolved channel profile used by the app.
- raw provider and import payloads are stored separately as source snapshots.
- manual admin edits are stored explicitly and must remain distinguishable from automated values.
- run results store the state of discovery/ranking at the time of the run for reproducibility and auditability.

### Acquisition order

New data enters the system in this order:

1. YouTube API
2. heuristics for email, sponsor mentions, and other inferred signals
3. LLM enrichment
4. HypeAuditor advanced reports when explicitly requested and approved

### Resolved value precedence

When multiple sources provide a value for the same field, the resolved channel profile uses this precedence:

1. admin manual edit
2. admin CSV import
3. HypeAuditor
4. LLM
5. heuristics
6. YouTube raw data

### Operational rules

- manual overrides must never be overwritten by automated refreshes or enrichments
- runs can read from the catalog and contribute newly discovered channels back into the catalog
- HypeAuditor requests require an approval workflow before execution
- HubSpot pushes use resolved catalog data, not raw snapshots

## Consequences

### Positive

- The catalog remains stable and understandable even as new workflows are added.
- Managers can reuse previously discovered creators instead of rediscovering them every time.
- Manual corrections remain durable.
- Source provenance stays auditable.
- Run results are reproducible and explainable.

### Tradeoffs

- We must maintain both raw source history and resolved channel state.
- Merge logic is explicit and cannot be left to ad hoc field updates.
- Admin tooling for manual edits and imports becomes part of the core product, not a side feature.

## Rejected alternatives

### Run-first canonical model

Rejected because the product requires a shared reusable creator database, not isolated run outputs.

### Flat channel records with no source provenance

Rejected because imports, enrichment, and manual edits need auditable precedence and traceability.

### Automatic HypeAuditor execution without approval

Rejected because HypeAuditor is an expensive escalation path and must stay controlled.

### Allowing automated sources to overwrite manual edits

Rejected because it would make admin correction workflows unreliable and force repeated cleanup.
