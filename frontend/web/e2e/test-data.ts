import path from "node:path";

export const PLAYWRIGHT_SEED_PATH = path.resolve(
  process.cwd(),
  "../../tmp/playwright-seed.json",
);

export const E2E_ADMIN = {
  email: "week8.e2e.admin@example.com",
  name: "Week 8 E2E Admin",
  password: "StrongAdminPassword123",
} as const;

export const E2E_MANAGER = {
  email: "week8.e2e.manager@example.com",
  name: "Week 8 E2E Manager",
  password: "StrongManagerPassword123",
  youtubeApiKey: "week8-e2e-youtube-key",
} as const;

export const E2E_CLIENT = {
  name: "Week 8 E2E Client",
  domain: "week8-e2e.example.com",
  countryRegion: "Germany",
  city: "Berlin",
} as const;

export const E2E_MARKET = {
  name: "Germany",
} as const;

export const E2E_CAMPAIGN = {
  name: "Week 8 E2E Campaign",
  briefLink: "https://docs.google.com/document/d/week8-e2e-campaign",
  month: "MARCH",
  year: 2026,
} as const;

export const E2E_CATALOG_CHANNEL = {
  youtubeChannelId: "UCweek8e2emain000000001",
  title: "Week 8 E2E Main Channel",
  handle: "@week8e2emain",
  description: "Primary channel used for authenticated Playwright launch-readiness coverage.",
  thumbnailUrl: "https://example.com/week8-e2e-main.png",
  contactEmail: "creator@week8-e2e.example.com",
} as const;

export const E2E_APPROVAL_CHANNEL = {
  youtubeChannelId: "UCweek8e2eapproval00002",
  title: "Week 8 E2E Approval Channel",
  handle: "@week8e2eapproval",
  description: "Pending approval channel used for admin workflow coverage.",
  thumbnailUrl: "https://example.com/week8-e2e-approval.png",
} as const;

export const E2E_RUN = {
  name: "Week 8 E2E Seeded Run",
  query: "gaming creators for launch-ready validation",
} as const;

export const E2E_SEEDED_EXPORT_FILE_NAME = "week8-e2e-seeded-export.csv";

export const E2E_SEEDED_CSV_IMPORT_FILE_NAME = "week8-e2e-seeded-import.csv";

export const E2E_SEEDED_HUBSPOT_IMPORT_FILE_NAME = "week8-e2e-hubspot-import.csv";

export const E2E_SEEDED_PUSH_ERROR = "Legacy push preserved for read-only review.";

export type PlaywrightSeedData = {
  admin: {
    id: string;
    email: string;
    password: string;
  };
  manager: {
    id: string;
    email: string;
    password: string;
  };
  campaign: {
    id: string;
    name: string;
  };
  channels: {
    catalog: {
      id: string;
      title: string;
    };
    approval: {
      id: string;
      title: string;
    };
  };
  batches: {
    csvImportFileName: string;
    csvExportFileName: string;
    hubspotImportFileName: string;
    hubspotRunName: string;
  };
};
