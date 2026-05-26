# Scouting Platform — User SOP

**Audience:** non-admin users (campaign managers, campaign leads, HOC)
**Goal:** run scouting, review results, and hand off to Google Sheets without admin help
**Last updated:** 2026-05-26

---

## 1. Sign In

1. Open your workspace URL. Login credentials are shared via the team password manager.
2. Enter the email and password your admin provided. Self sign-up is disabled.
3. You land on the **Dashboard**.

---

## 2. Workspace Map

| Surface | What it's for |
|---|---|
| **Dashboard** | Recent runs, filters, link straight to *Export to Sheets* on each run |
| **New Scouting** | Start a campaign-linked run |
| **Catalog** | Browse the canonical creator database, open creator detail, request enrichment |
| **Database** | Browse clients & campaigns (read-only for non-admins; data syncs from HubSpot) |

The export workspace opens automatically from a run (see §6). You won't see a separate "Exports" menu item — that history view is admin-only.

---

## 3. Before You Run Scouting

Open **Database → Campaigns** and confirm the campaign you need exists and is **active**.

Clients, campaigns and dropdown values are **synced from HubSpot** — they are not edited here.
If the campaign you need isn't there:

- Ask an **admin** or **campaign lead** to add the campaign in HubSpot.
- Wait for the next HubSpot sync (admins can trigger it from Database).
- The campaign then becomes selectable in **New Scouting**.

---

## 4. Start a Scouting Run

1. Click **New Scouting**.
2. Fill the form:
   - **Brief**
     - *Influencer List* — your label for this run (e.g. `Spring gaming outreach`).
     - *Campaign* — searchable dropdown of active campaigns.
     - *Campaign Manager* — who owns the outreach.
     - *Target creators* — how many you want.
   - **Reach** — drag the dual-range sliders or pick a preset:
     - *Subscribers*: Any / Nano (1K–10K) / Micro (10K–100K) / Mid (100K–500K) / Macro (500K–1M+)
     - *Median views*: Any / Low / Steady / Strong / Viral
   - **Audience**
     - *Country/Region*, *Language*, *Influencer Vertical* — searchable dropdowns sourced from synced HubSpot values.
     - *Last post (days)* — freshness threshold (e.g. `30`).
     - *Niche keywords* — free-text hint (e.g. `Competitive shooters, strategy RPGs`).

   There is **no free-form prompt field** — the form structure above *is* the brief.
3. Submit. The run is queued; campaign metadata is snapshotted onto it.
4. You're routed to the run detail page — it refreshes automatically while the worker runs.

---

## 5. Review Run Results

On the run detail page:

- Scan the **Matched creators** list against your target.
- Click any creator to open their **Catalog detail**. Admin manual overrides always win over automated data — trust what you see.
- On the creator detail page, click the **Enrichment** status pill to open the enrichment dialog. From there you can **Refresh enrichment** (re-run the LLM/YouTube enrichment for that creator).

---

## 6. Export — Google Sheets

There is **one** export path: append the prepared rows to an existing Google Sheet.

1. From the run detail page, click **Export to Sheets** (also available from the Dashboard row action).
2. You land on **Export to Google Sheets**.
3. Use the **Run defaults** panel to set shared dropdown values (currency, deal type, activation type).
   - Click **Save** when you're done editing defaults.
   - Click **CSV Download** (left of *Save*) at any time to grab the prepared rows as a CSV file.
4. Review the table — columns are pre-filled from the snapshot. Override per-row values where needed and **Save**.
5. In the **Google Sheets export** panel paste the *Spreadsheet URL or ID* and the target *Sheet name*.
6. Click **Export to Google Sheets**. Rows are appended to the sheet using its first-row headers; unmatched columns are left blank.

> You can also reach this same page from **Database → Runs → Google Sheets** when you're already in the Database workspace.

---

## 7. Daily Loop (TL;DR)

- **Dashboard** → check run status
- **New Scouting** → pick campaign → submit run
- **Run detail** → spot-check creators (refresh enrichment if a field looks stale)
- **Export to Google Sheets** → set defaults, save, paste sheet, export

---

## 8. When to Call an Admin

- New client / campaign needed — must be added in HubSpot first.
- Dropdown value missing — admins maintain dropdown values in Database.
- Wrong data on a creator that needs a manual override.
- Failed run with an error in Dashboard.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Run** | A snapshot of a discovery search tied to one campaign |
| **Catalog** | The canonical creator database (source of truth) |
| **Snapshot** | Frozen campaign + creator metadata stored on a run |
| **Manual override** | Admin-edited creator data that beats automated sources |
| **Export** | A Google Sheets append (and the CSV file you can also download from the export prep page) grouped under one ID |
| **Enrichment refresh** | Re-running LLM + YouTube enrichment on one creator from the creator detail dialog |
