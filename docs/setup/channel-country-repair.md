# Channel Country Repair

Use this workflow after deploying the country-provenance migration and YouTube country resolver.
The selected admin must be active and have an assigned YouTube API key.

## 1. Dry run

```bash
pnpm country:repair --admin-email=admin@example.com --limit=100
```

The command fetches only each channel's YouTube snippet, in batches of up to 50 channels, and
reports proposed changes. It does not
write catalog data without `--apply`. CSV, HypeAuditor, and admin-sourced countries are excluded.

## 2. Apply YouTube-declared countries

```bash
pnpm country:repair --admin-email=admin@example.com --limit=100 --apply
```

If `nextAfterId` is returned, process the next page:

```bash
pnpm country:repair --admin-email=admin@example.com --limit=100 --after-id=<nextAfterId> --apply
```

## 3. Optionally clear unverified legacy classifications

First dry-run this separately:

```bash
pnpm country:repair --admin-email=admin@example.com --limit=100 --clear-unverified
```

Add `--apply` only after reviewing the output. This clears legacy LLM countries when YouTube has no
declared country. Prefer unknown over a country inferred only from language or audience geography.

## Reading the result

- `set_youtube_declared`: fills a previously empty country.
- `replace_with_youtube_declared`: replaces an LLM/legacy country with YouTube's declaration.
- `clear_unverified`: clears an LLM/legacy country with no YouTube declaration.
- `youtube_country_missing`: YouTube has no declared country; no change by default.
- `youtube_country_unmapped`: YouTube returned a code that does not map to the synced dropdown.
- `failed`: the individual channel lookup failed; the page continues unless auth/quota fails.

Every applied page writes an audit event. The command never overwrites protected country sources.
