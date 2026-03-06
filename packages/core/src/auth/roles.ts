import { Role } from "@prisma/client";

import type { Role as ContractRole } from "@scouting-platform/contracts";

export function toPrismaRole(role: ContractRole): Role {
  return role === "admin" ? Role.ADMIN : Role.USER;
}

export function fromPrismaRole(role: Role): ContractRole {
  return role === Role.ADMIN ? "admin" : "user";
}
