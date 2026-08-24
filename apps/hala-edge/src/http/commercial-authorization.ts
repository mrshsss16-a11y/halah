import type { OrganizationRole } from "@hala/contracts";

export function canMutateProductContent(role: OrganizationRole): boolean {
  return role === "owner" || role === "operator";
}

export function canReviewProductContent(role: OrganizationRole): boolean {
  return role === "owner" || role === "operator" || role === "reviewer";
}

export function canStageProductContentExport(role: OrganizationRole): boolean {
  return role === "owner";
}

export function canManageStoreConnection(role: OrganizationRole): boolean {
  return role === "owner";
}
