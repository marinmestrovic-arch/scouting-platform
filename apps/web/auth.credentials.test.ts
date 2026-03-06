import { randomUUID } from "node:crypto";

import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "@scouting-platform/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

integration("credentials auth flow", () => {
  let prisma: PrismaClient;
  let authConfig: typeof import("./auth").authConfig;

  type AuthAdapter = {
    createSession?: (session: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }) => Promise<{ sessionToken: string; userId: string }>;
  };

  const getAuthAdapter = () =>
    (authConfig as typeof authConfig & { adapter?: AuthAdapter }).adapter;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week1-auth-secret";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    ({ authConfig } = await import("./auth"));
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        saved_segments,
        run_results,
        run_requests,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        channels,
        users
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function getCredentialsAuthorize(): (
    credentials: Record<string, unknown>,
    request: Request,
  ) => Promise<unknown> {
    const provider = authConfig.providers?.[0] as
      | {
          id?: string;
          authorize?: (
            credentials: Partial<Record<string, unknown>>,
            request: Request,
          ) => unknown;
        }
      | undefined;

    if (!provider || provider.id !== "credentials") {
      throw new Error("Credentials provider is not configured");
    }

    if (typeof provider.authorize !== "function") {
      throw new Error("Credentials provider authorize function is missing");
    }

    return async (credentials: Record<string, unknown>, request: Request) =>
      provider.authorize?.(credentials, request) ?? null;
  }

  it("authorizes valid credentials and rejects invalid/inactive users", async () => {
    const authorize = getCredentialsAuthorize();

    const userPassword = "StrongPassword123";
    const userPasswordHash = await hashPassword(userPassword);

    const activeUser = await prisma.user.create({
      data: {
        email: "active@example.com",
        name: "Active User",
        role: Role.USER,
        passwordHash: userPasswordHash,
        isActive: true,
      },
    });

    const validResult = await authorize(
      {
        email: "ACTIVE@example.com",
        password: userPassword,
      },
      new Request("http://localhost/api/auth/callback/credentials"),
    );

    expect(validResult).toMatchObject({
      id: activeUser.id,
      email: "active@example.com",
      role: "user",
    });

    const wrongPasswordResult = await authorize(
      {
        email: "active@example.com",
        password: "WrongPassword123",
      },
      new Request("http://localhost/api/auth/callback/credentials"),
    );
    expect(wrongPasswordResult).toBeNull();

    const inactivePasswordHash = await hashPassword(userPassword);
    await prisma.user.create({
      data: {
        email: "inactive@example.com",
        name: "Inactive User",
        role: Role.USER,
        passwordHash: inactivePasswordHash,
        isActive: false,
      },
    });

    const inactiveResult = await authorize(
      {
        email: "inactive@example.com",
        password: userPassword,
      },
      new Request("http://localhost/api/auth/callback/credentials"),
    );
    expect(inactiveResult).toBeNull();
  });

  it("creates database session via configured Auth.js adapter", async () => {
    const adapter = getAuthAdapter();

    if (!adapter?.createSession) {
      expect(authConfig.session?.strategy).toBe("jwt");
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: "session@example.com",
        name: "Session User",
        role: Role.USER,
        passwordHash: await hashPassword("StrongPassword123"),
        isActive: true,
      },
    });

    const sessionToken = randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    const createdSession = await adapter.createSession({
      sessionToken,
      userId: user.id,
      expires,
    });

    expect(createdSession.sessionToken).toBe(sessionToken);
    expect(createdSession.userId).toBe(user.id);

    const storedSession = await prisma.session.findUnique({
      where: {
        sessionToken,
      },
    });
    expect(storedSession).not.toBeNull();
    expect(storedSession?.userId).toBe(user.id);
  });
});
