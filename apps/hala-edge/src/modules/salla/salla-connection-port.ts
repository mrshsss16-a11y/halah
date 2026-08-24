export type SallaConnectionLifecycleStatus =
  "authorizing" | "active" | "reauthorization_required" | "revoked" | "failed";

export interface SallaConnectionPort {
  markAuthorizing(input: Readonly<{ organizationId: string; updatedAt: string }>): Promise<void>;
  activateLocalMock(
    input: Readonly<{
      organizationId: string;
      externalStoreId: string;
      authorizationScope: string;
      connectedAt: string;
    }>
  ): Promise<boolean>;
}
