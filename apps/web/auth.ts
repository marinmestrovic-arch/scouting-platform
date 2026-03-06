import { findUserForCredentials, verifyPassword } from "@scouting-platform/core";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { resolveAppRole, type AppRole } from "./lib/navigation";

const DEV_AUTH_SECRET = "week0-dev-auth-secret-not-for-production";
const DEFAULT_APP_ROLE: AppRole = "user";

type AuthEnv = Readonly<Record<string, string | undefined>>;

function normalizeCredential(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function resolveAuthSecret(env: AuthEnv = process.env): string | undefined {
  const rawSecret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET;
  const trimmedSecret = typeof rawSecret === "string" ? rawSecret.trim() : "";

  if (trimmedSecret.length > 0) {
    return trimmedSecret;
  }

  if (env.NODE_ENV !== "production") {
    return DEV_AUTH_SECRET;
  }

  return undefined;
}

const authSecret = resolveAuthSecret();

export const authConfig = {
  ...(authSecret ? { secret: authSecret } : {}),
  pages: {
    signIn: "/login"
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "name@company.com"
        },
        password: {
          label: "Password",
          type: "password"
        }
      },
      async authorize(credentials) {
        const email = normalizeCredential(credentials?.email).toLowerCase();
        const password = normalizeCredential(credentials?.password);

        if (!email || !password) {
          return null;
        }

        const user = await findUserForCredentials(email);

        if (!user || !user.isActive) {
          return null;
        }

        const isPasswordValid = await verifyPassword(password, user.passwordHash);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name ?? user.email,
          email: user.email,
          role: resolveAppRole(user.role, DEFAULT_APP_ROLE)
        };
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = resolveAppRole(user.role, DEFAULT_APP_ROLE);

        if (typeof user.id === "string" && user.id.length > 0) {
          token.sub = user.id;
        }
      } else {
        token.role = resolveAppRole(token.role, DEFAULT_APP_ROLE);
      }

      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: typeof token.sub === "string" ? token.sub : "",
        role: resolveAppRole(token.role, DEFAULT_APP_ROLE)
      };

      return session;
    }
  },
  session: {
    strategy: "jwt"
  }
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
