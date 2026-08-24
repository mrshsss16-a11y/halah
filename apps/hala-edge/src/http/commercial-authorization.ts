import type { OrganizationRole } from "@hala/contracts";

export function canMutateProductContent(role: OrganizationRole): boolean {
  return role === "owner" || role === "operator";
}

export function canStageProductContentExport(role: OrganizationRole): boolean {
  return role === "owner";
}
