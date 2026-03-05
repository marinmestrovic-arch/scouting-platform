import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  getWeek0DemoCredentialsFromEnv,
  getWeek0DemoRoleFromEnv,
  isWeek0DemoCredentialsMatch,
  WEEK0_DEMO_ROLE_FALLBACK
} from "./lib/auth-flow";
import { resolveAppRole } from "./lib/navigation";

const week0DemoCredentials = getWeek0DemoCredentialsFromEnv();
const week0DemoRole = getWeek0DemoRoleFromEnv();

export const authConfig = {
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
      authorize(credentials) {
        if (!isWeek0DemoCredentialsMatch(credentials?.email, credentials?.password)) {
          return null;
        }

        return {
          id: "week0-demo-user",
          name: "Week 0 User",
          email: week0DemoCredentials.email,
          role: week0DemoRole
        };
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = resolveAppRole(user.role, WEEK0_DEMO_ROLE_FALLBACK);
      } else {
        token.role = resolveAppRole(token.role, WEEK0_DEMO_ROLE_FALLBACK);
      }

      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        role: resolveAppRole(token.role, WEEK0_DEMO_ROLE_FALLBACK)
      };

      return session;
    }
  },
  session: {
    strategy: "jwt"
  }
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
