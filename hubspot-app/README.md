# Scouting Platform HubSpot app

This is a local HubSpot developer-platform `2026.03` project for private,
single-account installation. It is intentionally outside the pnpm workspace and
is not uploaded by the application build.

Before any upload:

1. Replace every `scouting.example.com` and support placeholder in
   `src/app/app-hsmeta.json`, `src/app/cards/ScoutingContextCard.jsx`, and
   `src/app/webhooks/scouting-platform-webhooks-hsmeta.json` with the same
   production HTTPS origin.
2. Keep the context endpoint path unchanged unless the platform route changes.
3. Keep every webhook subscription inactive until the signed endpoint is
   deployed, `HUBSPOT_WEBHOOKS_ENABLED` is ready to be enabled, and the exact
   contact/deal subscription set has been reviewed. The `2026.03` manifest uses
   generic `object.*` events; HubSpot identifies contacts and deals in delivery
   payloads with `objectTypeId`.
4. If a campaign card is desired, copy
   `campaign-context-card-hsmeta.json.example` to a file ending in
   `-hsmeta.json` and replace the `p_...` object name with the portal's
   discovered campaign custom-object name. The single-app manifest already
   includes the custom-object scope required by the V2 backend and this card.
5. Configure `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_PORTAL_ID`, and the matching
   numeric `HUBSPOT_APP_ID` on the platform. The endpoint validates HubSpot
   request signatures and portal/app/record context; it does not accept an
   anonymous browser session.
6. Install the current HubSpot CLI, authenticate a developer account, and use a
   developer test account first. `hs project upload` and installation are
   deliberately human-run portal-side actions and were not run for this change.

`hubspot.fetch()` automatically appends signed `portalId`, `userId`, `userEmail`,
and `appId` query parameters. No access token or client secret belongs in this
directory.
