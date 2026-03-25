import { Role, UserType } from "@prisma/client";

import type { Role as ContractRole, UserType as ContractUserType } from "@scouting-platform/contracts";

export function toPrismaRole(role: ContractRole): Role {
  return role === "admin" ? Role.ADMIN : Role.USER;
}

export function fromPrismaRole(role: Role): ContractRole {
  return role === Role.ADMIN ? "admin" : "user";
}

export function toPrismaUserType(userType: ContractUserType): UserType {
  switch (userType) {
    case "admin":
      return UserType.ADMIN;
    case "campaign_lead":
      return UserType.CAMPAIGN_LEAD;
    case "hoc":
      return UserType.HOC;
    default:
      return UserType.CAMPAIGN_MANAGER;
  }
}

export function fromPrismaUserType(userType: UserType): ContractUserType {
  switch (userType) {
    case UserType.ADMIN:
      return "admin";
    case UserType.CAMPAIGN_LEAD:
      return "campaign_lead";
    case UserType.HOC:
      return "hoc";
    default:
      return "campaign_manager";
  }
}
