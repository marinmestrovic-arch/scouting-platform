# Decision Note: Manual-Only Override Precedence

- Status: Proposed
- Date: 2026-03-11
- Owner: Ivan

---

# Purpose

This document isolates one product/data-governance question from the enrichment implementation
work:

Should `admin_manual` be the only override layer above automated/provider-derived values, with
`csv_import` no longer outranking `HypeAuditor`, `LLM`, `heuristics`, and `YouTube raw`?

This is **not** part of the current enrichment extensions / YouTube raw metrics implementation
plan. It is a separate decision.

---

# Current Locked Precedence

The repository currently defines resolved field precedence as:

1. `admin_manual`
2. `csv_import`
3. `hypeauditor`
4. `llm`
5. `heuristics`
6. `youtube_raw`

This order appears in:

- [PROJECTS_SPECS.md](/Users/ivanbobas/Projects/scouting-platform/PROJECTS_SPECS.md)
- [ARCHITECTURE.md](/Users/ivanbobas/Projects/scouting-platform/ARCHITECTURE.md)
- [AGENTS.md](/Users/ivanbobas/Projects/scouting-platform/AGENTS.md)

Under the current rules, CSV imports are intentionally authoritative over all automated/provider
sources except manual admin edits.

---

# Proposed Change

The proposed policy is:

1. `admin_manual`
2. provider/import/raw sources resolved by field ownership rules rather than a global `csv_import`
   override tier

In practical terms, that means:

- manual admin edits remain the top override
- CSV imports would no longer automatically outrank `HypeAuditor`, `LLM`, `heuristics`, and
  `YouTube raw`
- CSV-imported values would need to compete on a field-by-field ownership model instead of winning
  globally because they came from CSV

---

# Why Consider It

This change would better match the intuition that some fields are more trustworthy when sourced
directly from a provider than when imported from an operator-managed CSV.

Examples:

- YouTube platform metrics may be more reliable from YouTube than from a stale CSV
- HypeAuditor audience/commercial fields may be more reliable than imported approximations
- LLM interpretive fields should likely never be replaced by a CSV unless the team explicitly wants
  that behavior

It would also simplify the mental model:

- manual edits are explicit overrides
- everything else follows field ownership, freshness, and provider-specific trust rules

---

# Why It Is Not Included In The Current Implementation

This is a precedence change, not just an implementation detail.

It affects:

- data precedence rules
- merge/update logic across existing flows
- expectations for CSV imports
- behavior of resolved channel data shown in the app

Because of that, it should not be folded silently into the enrichment/raw-metrics work.

---

# Architectural Implication

Per the current repo rules, changing data precedence is an architecture-level decision.

If this direction is chosen, the next step should likely be:

1. founder agreement on the new precedence model
2. an ADR describing the new rule
3. targeted implementation planning for affected field families

This should not be treated as already approved.

---

# Open Questions

- Should CSV remain authoritative for imported contact fields but not for metrics?
- Should CSV remain authoritative only for fields with no trusted provider source?
- Should field ownership fully replace the current single global precedence order?
- Which exact fields, if any, should still allow CSV to outrank provider data?
- How should historical imported values be treated if the rule changes?

---

# Recommendation

Keep the current implementation plan unchanged and preserve the locked precedence order for now.

If the team wants `admin_manual` to be the only true override layer, handle that as a separate ADR
and implementation slice after agreeing on a field-by-field governance model.
