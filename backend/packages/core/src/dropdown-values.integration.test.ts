import { PrismaClient, Role } from "@prisma/client";
import { createPrismaClient } from "@scouting-platform/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type DropdownValuesModule = typeof import("./dropdown-values");

integration("dropdown values core integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    prisma = createPrismaClient({ databaseUrl });

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

  it("does not restore deleted seeded currency values after replacing the field", async () => {
    const dropdownValues = await loadDropdownValues();
    const admin = await createAdminUser();

    const initial = await dropdownValues.listDropdownValues();
    const initialCurrencies = initial.items
      .filter((item) => item.fieldKey === "currency")
      .map((item) => item.value)
      .sort((left, right) => left.localeCompare(right));

    expect(initialCurrencies).toEqual(["EUR", "GBP", "USD"]);

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
});
