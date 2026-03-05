import type { DefaultSession } from "next-auth";
import type { AppRole } from "../lib/navigation";

declare module "next-auth" {
  interface User {
    role: AppRole;
  }

  interface Session {
    user: DefaultSession["user"] & {
      role: AppRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
  }
}
