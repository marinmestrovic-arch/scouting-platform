import { Role, UserType } from "@prisma/client";
import { COUNTRY_REGION_OPTIONS } from "@scouting-platform/contracts";

import { hashPassword } from "../packages/core/src/auth/password";
import { disconnectPrisma, prisma } from "../packages/db/src";

async function upsertUser(input: {
  email: string;
  name: string;
  role: Role;
  userType: UserType;
  password: string;
}) {
  const passwordHash = await hashPassword(input.password);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      role: input.role,
      userType: input.userType,
      isActive: true,
      passwordHash,
    },
    create: {
      email: input.email,
      name: input.name,
      role: input.role,
      userType: input.userType,
      isActive: true,
      passwordHash,
    },
  });
}

async function main() {
  try {
    const [sony, lego, hocUser] = await Promise.all([
      prisma.client.upsert({
        where: { name: "Sony" },
        update: {
          domain: "sony.com",
          countryRegion: "Germany",
          city: "Berlin",
        },
        create: {
          name: "Sony",
          domain: "sony.com",
          countryRegion: "Germany",
          city: "Berlin",
        },
      }),
      prisma.client.upsert({
        where: { name: "LEGO" },
        update: {
          domain: "lego.com",
          countryRegion: "United Kingdom",
          city: "London",
        },
        create: {
          name: "LEGO",
          domain: "lego.com",
          countryRegion: "United Kingdom",
          city: "London",
        },
      }),
      upsertUser({
        email: "hoc@example.com",
        name: "Head of Campaigns",
        role: Role.USER,
        userType: UserType.HOC,
        password: "StrongAdminPassword123",
      }),
    ]);

    await Promise.all(
      COUNTRY_REGION_OPTIONS.map((country) =>
        prisma.market.upsert({
          where: { name: country },
          update: {},
          create: { name: country },
        }),
      ),
    );

    const [germany, unitedKingdom] = await Promise.all([
      prisma.market.findUniqueOrThrow({ where: { name: "Germany" } }),
      prisma.market.findUniqueOrThrow({ where: { name: "United Kingdom" } }),
    ]);

    await Promise.all([
      upsertUser({
        email: "cm.one@example.com",
        name: "Campaign Manager One",
        role: Role.USER,
        userType: UserType.CAMPAIGN_MANAGER,
        password: "StrongAdminPassword123",
      }),
      upsertUser({
        email: "cm.two@example.com",
        name: "Campaign Manager Two",
        role: Role.USER,
        userType: UserType.CAMPAIGN_MANAGER,
        password: "StrongAdminPassword123",
      }),
    ]);

    await Promise.all([
      prisma.campaign.upsert({
        where: {
          name_clientId_marketId_month_year: {
            name: "Sony Gaming Spring",
            clientId: sony.id,
            marketId: germany.id,
            month: "MARCH",
            year: 2026,
          },
        },
        update: { isActive: true, createdByUserId: hocUser.id },
        create: {
          name: "Sony Gaming Spring",
          clientId: sony.id,
          marketId: germany.id,
          briefLink: "https://docs.google.com/document/d/sony-gaming-spring",
          month: "MARCH",
          year: 2026,
          isActive: true,
          createdByUserId: hocUser.id,
        },
      }),
      prisma.campaign.upsert({
        where: {
          name_clientId_marketId_month_year: {
            name: "LEGO Family UK",
            clientId: lego.id,
            marketId: unitedKingdom.id,
            month: "APRIL",
            year: 2026,
          },
        },
        update: { isActive: true, createdByUserId: hocUser.id },
        create: {
          name: "LEGO Family UK",
          clientId: lego.id,
          marketId: unitedKingdom.id,
          briefLink: "https://docs.google.com/document/d/lego-family-uk",
          month: "APRIL",
          year: 2026,
          isActive: true,
          createdByUserId: hocUser.id,
        },
      }),
    ]);

    process.stdout.write("Seeded workspace clients, markets, campaigns, and campaign managers.\n");
  } finally {
    await disconnectPrisma();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
