import { PrismaClient, Role } from "@prisma/client";
import { PLATFORM_MANAGED_DROPDOWN_VALUES } from "@scouting-platform/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type DropdownValuesModule = typeof import("./dropdown-values");

integration("dropdown values core integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        dropdown_values,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        users
      RESTART IDENTITY CASCADE
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadDropdownValues(): Promise<DropdownValuesModule> {
    return import("./dropdown-values");
  }

  async function createAdminUser(): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function seedHubspotBackedFields(): Promise<void> {
    await prisma.dropdownValue.createMany({
      data: [
        { fieldKey: "CURRENCY", value: "GBP" },
        { fieldKey: "DEAL_TYPE", value: "Old deal type" },
        { fieldKey: "ACTIVATION_TYPE", value: "Old activation type" },
        { fieldKey: "INFLUENCER_TYPE", value: "Male" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Gaming" },
        { fieldKey: "COUNTRY_REGION", value: "Croatia" },
        { fieldKey: "LANGUAGE", value: "Croatian" },
      ],
    });
  }

  it("seeds platform-managed dropdown values before sync", async () => {
    const dropdownValues = await loadDropdownValues();
    const admin = await createAdminUser();

    const initial = await dropdownValues.listDropdownValues();
    const initialCurrencies = initial.items
      .filter((item) => item.fieldKey === "currency")
      .map((item) => item.value)
      .sort((left, right) => left.localeCompare(right));

    expect(initialCurrencies).toEqual([]);
    expect(initial.items.filter((item) => item.fieldKey === "influencerType").map((item) => item.value)).toEqual(
      [...PLATFORM_MANAGED_DROPDOWN_VALUES.influencerType].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(
      initial.items
        .filter((item) => item.fieldKey === "influencerVertical")
        .map((item) => item.value),
    ).toEqual(
      [...PLATFORM_MANAGED_DROPDOWN_VALUES.influencerVertical].sort((left, right) =>
        left.localeCompare(right),
      ),
    );

    await dropdownValues.replaceDropdownValues({
      actorUserId: admin.id,
      fieldKey: "currency",
      values: ["EUR", "USD"],
    });

    const updated = await dropdownValues.listDropdownValues();
    const updatedCurrencies = updated.items
      .filter((item) => item.fieldKey === "currency")
      .map((item) => item.value)
      .sort((left, right) => left.localeCompare(right));

    expect(updatedCurrencies).toEqual(["EUR", "USD"]);
  });

  it("rejects manual edits for platform-managed dropdown fields", async () => {
    const dropdownValues = await loadDropdownValues();
    const admin = await createAdminUser();

    await expect(
      dropdownValues.replaceDropdownValues({
        actorUserId: admin.id,
        fieldKey: "influencerType",
        values: ["Custom"],
      }),
    ).rejects.toMatchObject({
      message: "influencerType is managed by the platform and cannot be edited here",
    });
  });

  it("syncs hubspot-backed dropdown values from HubSpot and replaces prior saved values", async () => {
    const dropdownValues = await loadDropdownValues();
    const admin = await createAdminUser();

    await seedHubspotBackedFields();

    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/account-info/v3/details")) {
        return new Response(
          JSON.stringify({
            companyCurrency: "EUR",
            additionalCurrencies: ["USD"],
          }),
        );
      }

      if (url.includes("/deals/dealtype")) {
        return new Response(
          JSON.stringify({
            name: "dealtype",
            label: "Deal Type",
            type: "enumeration",
            options: [{ label: "Flat Fee", value: "Influencer Collaboration" }],
          }),
        );
      }

      if (url.includes("/2-200856187/activation_type")) {
        return new Response(
          JSON.stringify({
            name: "activation_type",
            label: "Activation Type",
            type: "enumeration",
            options: [{ label: "Dedicated Video", value: "Dedicated Video" }],
          }),
        );
      }

      if (url.includes("/influencer_type")) {
        return new Response(
          JSON.stringify({
            name: "influencer_type",
            label: "Influencer Type",
            type: "enumeration",
            options: [{ label: "Female", value: "Female" }],
          }),
        );
      }

      if (url.includes("/influencer_vertical")) {
        return new Response(
          JSON.stringify({
            name: "influencer_vertical",
            label: "Influencer Vertical",
            type: "enumeration",
            options: [{ label: "Tech", value: "Tech" }],
          }),
        );
      }

      if (url.includes("/country")) {
        return new Response(
          JSON.stringify({
            name: "country",
            label: "Country/Region",
            type: "enumeration",
            options: [{ label: "Germany", value: "Germany" }],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          name: "language",
          label: "Language",
          type: "enumeration",
          options: [{ label: "German", value: "German" }],
        }),
      );
    });

    const updated = await dropdownValues.syncHubspotDropdownValues({
      actorUserId: admin.id,
      apiKey: "hubspot-key",
      fetchFn,
    });

    expect(updated.items.filter((item) => item.fieldKey === "currency").map((item) => item.value)).toEqual([
      "EUR",
      "USD",
    ]);
    expect(updated.items.filter((item) => item.fieldKey === "dealType").map((item) => item.value)).toEqual([
      "Flat Fee",
    ]);
    expect(updated.items.filter((item) => item.fieldKey === "activationType").map((item) => item.value)).toEqual([
      "Dedicated Video",
    ]);
    expect(updated.items.filter((item) => item.fieldKey === "influencerType").map((item) => item.value)).toEqual(
      [...PLATFORM_MANAGED_DROPDOWN_VALUES.influencerType].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(
      updated.items
        .filter((item) => item.fieldKey === "influencerVertical")
        .map((item) => item.value),
    ).toEqual(
      [...PLATFORM_MANAGED_DROPDOWN_VALUES.influencerVertical].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(updated.items.filter((item) => item.fieldKey === "countryRegion").map((item) => item.value)).toEqual([
      "Germany",
    ]);
    expect(updated.items.filter((item) => item.fieldKey === "language").map((item) => item.value)).toEqual([
      "German",
    ]);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "dropdown_value.synced_from_hubspot",
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({
      syncedFields: expect.arrayContaining([
        { fieldKey: "currency", valueCount: 2 },
        { fieldKey: "dealType", valueCount: 1 },
        { fieldKey: "activationType", valueCount: 1 },
        { fieldKey: "countryRegion", valueCount: 1 },
        { fieldKey: "language", valueCount: 1 },
      ]),
    });
  });
});
