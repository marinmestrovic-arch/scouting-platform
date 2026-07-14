# ADR-005: YouTube-Declared Creator Country Precedence

- Status: Accepted
- Date: 2026-07-14

## Context

Creator country is currently inferred by LLM enrichment when CSV data is absent. This has produced
materially incorrect catalog labels because language, audience geography, and places mentioned in
content are not reliable evidence of the creator's own location.

The YouTube channel resource exposes `snippet.country`, which is the country associated with the
channel and is set through the channel's branding settings. It is optional and self-declared, but
when present it is stronger creator-location evidence than an LLM inference.

ADR-002 defines a global source precedence where LLM data outranks YouTube raw data. Applying that
order to creator country preserves known bad classifications, so this field needs a documented
exception with explicit provenance.

## Decision

`channels.country_region` stores creator country, never audience country. The field also stores its
resolved source in `channels.country_region_source`.

Creator country uses this field-specific precedence:

1. `admin_manual`
2. `csv_import`
3. `hypeauditor`
4. `youtube_declared`
5. `llm`

YouTube `snippet.country` is normalized deterministically to the configured Country/Region dropdown.
LLM inference is used only when YouTube does not declare a country and the model returns an allowed
dropdown value. Unknown country remains null rather than being guessed from language or audience.

Automated refreshes never overwrite `admin_manual`, `csv_import`, or `hypeauditor` country values.
Audience-country insights remain separate in `channel_insights.audience_countries`.

Existing populated countries with matching imported CSV evidence are backfilled as `csv_import`.
Other existing populated countries are backfilled as `llm`, which reflects the current pre-change
automated writer and allows a controlled repair workflow.

## Consequences

- New and refreshed channels use deterministic YouTube-declared country when available.
- Country provenance is queryable and future repair runs can respect higher-precedence sources.
- Existing LLM-derived values can be dry-run, replaced from YouTube, or explicitly cleared when
  YouTube provides no declaration.
- Missing YouTube country remains a coverage limitation; the system will prefer unknown over a weak
  guess.
- This is a narrow exception to ADR-002. Other fields retain ADR-002's existing precedence.
