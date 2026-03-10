# Project Specs

## 1. Product Definition

`scouting-platform` is an internal company tool for campaign managers who need to find, evaluate,
and shortlist YouTube creators for campaigns.

The product combines:
- a persistent creator catalog
- run-based discovery
- automated enrichment
- admin-only data import and editing
- manual export/push workflows into HubSpot

## 2. Users and Roles

### Admin

Admins are the system operators.

They can:
- manage users
- assign/update user YouTube API keys
- import channel/contact data through CSV
- manually edit channel/contact fields
- approve or reject HypeAuditor advanced report requests
- trigger/administer system maintenance and monitor worker health

Initial admins:
- Ivan
- Marin

### User

Users are campaign managers.

They can:
- browse the channel catalog
- view channel detail pages
- see contact emails
- create new scouting runs
- use their assigned YouTube Data API key through the app
- save personal segments
- request enrichment and HypeAuditor reports
- export creators to CSV
- push selected creators to HubSpot

## 3. Authentication and Account Lifecycle

- Authentication method: email + password
- User signup: disabled
- Account creation: admin-only
- Password reset: admin-managed in v1
- Email verification: not needed
- Session model: server-side authenticated session

## 4. Integration Ownership

### User-owned
- YouTube Data API key

### Company-owned
- OpenAI API key
- HypeAuditor API key
- HubSpot API key

### Operational Rule
- Admins enter and manage user YouTube keys
- Users do not self-manage keys in v1

## 5. Locked v1 Feature Scope

### Required
- channel catalog
- channel detail view
- saved segments
- run-based discovery
- LLM enrichment
- HypeAuditor enrichment request flow
- admin dashboard
- CSV export
- admin-only CSV import of contacts and metrics
- background jobs
- manual push of selected creators to HubSpot
- persistent database of all discovered/imported creators
- new runs must use both existing catalog data and newly discovered channels
- admin manual editing of channel/contact fields

### Nice to Have but Still In Scope if Time Holds
- shared admin-authored segment templates
- basic approval queue analytics on the admin dashboard

## 6. Explicit Non-Goals for v1

- public product access
- payments
- email sending
- email verification flows
- password reset emails
- machine learning beyond LLM enrichment
- automatic HubSpot sync
- generic CSV column mapping
- browser-direct provider integrations
- multi-tenant organizations
- mobile app
- analytics tooling for product usage

## 7. Data Source and Precedence Rules

### Acquisition Order
1. YouTube API
2. heuristics for email and brand mention detection
3. LLM enrichment
4. HypeAuditor advanced report when requested and approved

### Resolved Field Precedence
1. admin manual edit
2. admin CSV import
3. HypeAuditor
4. LLM enrichment
5. heuristics
6. YouTube raw data

### Hard Rule
Automated ingestions never overwrite a field that has an active admin manual override.

## 8. Approval Rule for HypeAuditor

Managers may request HypeAuditor advanced reports, but every request must be approved by an admin
before execution.

Managers may request a new advanced report even when a prior completed report exists.
Admins must be able to see how many days ago the last completed report finished and whether it is
still inside the 120-day review window.

Request lifecycle:
- `pending_approval`
- `approved`
- `rejected`
- `queued`
- `running`
- `completed`
- `failed`

All request/approval actions must be audited.

## 9. Run Behavior

When a manager creates a run:
1. validate the user and assigned YouTube key
2. search the existing catalog for relevant candidates
3. discover new channels using the user’s YouTube key
4. upsert newly found channels into the catalog
5. rank the union of existing and new candidates
6. store the run as a snapshot for reproducibility
7. queue missing or stale enrichment jobs where needed

The catalog remains the canonical dataset.

## 10. CSV Import Rules

V1 import is strict-template only.

Admin import supports:
- channel identifiers
- contact emails
- metrics fields
- optional notes / source metadata

Imports must produce:
- batch summary
- row-level validation errors
- audit trail

## 11. CSV Export Rules

Managers can export selected creators.

Export requirements:
- only selected or filtered result sets
- consistent column schema
- background-safe if export size grows
- audit event for every export

## 12. HubSpot Push Rules

V1 HubSpot is manual push only.

Requirements:
- manager selects creators
- manager starts push manually
- push runs in background job
- per-record result is stored
- failures remain visible for retry/debugging

No automatic sync logic in v1.

## 13. Security Rules

- No provider secret exposed to the browser
- User YouTube API keys stored encrypted at rest
- Authorization enforced server-side on every protected action
- Admin-only routes remain admin-only even if UI hides/show logic fails
- Audit log required for admin edits, approvals, imports, exports, and HubSpot pushes

## 14. Quality Bar

Before first internal launch:
- full CI active
- migrations deterministic
- staging environment exists
- backup/restore process documented
- core Playwright flows passing
- worker separated from web app

## 15. Success Criteria for v1

The rewrite is successful when:
- managers can reliably find creators through catalog and runs
- admins can manage data quality manually
- enrichment and HypeAuditor flows are visible and auditable
- channel/contact data can move cleanly into HubSpot
- the team does not need a structural architecture change after the first launch
