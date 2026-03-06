import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { credentialsSignInSchema } from "@scouting-platform/contracts";
import { findUserForCredentials, verifyPassword } from "@scouting-platform/core";
import { prisma } from "@scouting-platform/db";

const authSecret = process.env.AUTH_SECRET;

if (process.env.NODE_ENV === "production" && !authSecret) {
  throw new Error("AUTH_SECRET must be set when NODE_ENV=production");
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma) as Adapter,
  session: {
    strategy: "database",
  },
  providers: [
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSignInSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const user = await findUserForCredentials(parsed.data.email);

        if (!user || !user.isActive) {
          return null;
        }

        const validPassword = await verifyPassword(
          parsed.data.password,
          user.passwordHash,
        );

        if (!validPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = user.role === "admin" ? "admin" : "user";
      }

      return session;
    },
  },
  ...(authSecret ? { secret: authSecret } : {}),
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
