import type { SallaConnectionPort } from "./salla-connection-port";
import type { SallaOAuthStateService } from "./salla-oauth-state-service";

export type StartLocalSallaAuthorizationOutcome = Readonly<{
  kind: "authorization_started";
  state: string;
  expiresAt: string;
}>;

export type CompleteLocalSallaAuthorizationOutcome =
  | Readonly<{ kind: "connected"; organizationId: string }>
  | Readonly<{ kind: "connection_not_authorizing" }>
  | Readonly<{ kind: "state_rejected" }>
  | Readonly<{ kind: "state_already_consumed" }>;

export class SallaConnectionService {
  public constructor(
    private readonly oauthStateService: SallaOAuthStateService,
    private readonly connectionPort: SallaConnectionPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async startLocalAuthorization(input: {
    organizationId: string;
  }): Promise<StartLocalSallaAuthorizationOutcome> {
    const authorization = await this.oauthStateService.create({
      organizationId: input.organizationId
    });
    await this.connectionPort.markAuthorizing({
      organizationId: input.organizationId,
      updatedAt: this.clock().toISOString()
    });

    return {
      kind: "authorization_started",
      state: authorization.rawState,
      expiresAt: authorization.expiresAt
    };
  }

  public async completeLocalAuthorization(
    state: string
  ): Promise<CompleteLocalSallaAuthorizationOutcome> {
    const consumed = await this.oauthStateService.consume(state);
    if (consumed.kind === "missing_or_expired") {
      return { kind: "state_rejected" };
    }
    if (consumed.kind === "already_consumed") {
      return { kind: "state_already_consumed" };
    }

    const connectedAt = this.clock().toISOString();
    const didActivate = await this.connectionPort.activateLocalMock({
      organizationId: consumed.organizationId,
      externalStoreId: `local-salla-${consumed.organizationId}`,
      authorizationScope: "local:mock",
      connectedAt
    });
    if (!didActivate) {
      return { kind: "connection_not_authorizing" };
    }

    return { kind: "connected", organizationId: consumed.organizationId };
  }
}
