import type { LoginInput, SignUpInput } from "@hala/contracts";
import type { IdentityRepositoryPort } from "./identity-port";
import { createPasswordDigest, verifyPassword } from "../../security/password";
import { issueSessionToken } from "../../security/session-token";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export type AuthenticatedSession = Readonly<{
  rawToken: string;
  expiresAt: string;
}>;

export type SignUpOutcome =
  Readonly<{ kind: "created"; session: AuthenticatedSession }> | Readonly<{ kind: "email_taken" }>;

export type LoginOutcome =
  | Readonly<{ kind: "authenticated"; session: AuthenticatedSession }>
  | Readonly<{ kind: "invalid_credentials" }>;

function nowIso(now: Date): string {
  return now.toISOString();
}

function expiryIso(now: Date): string {
  return new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
}

export class IdentityService {
  public constructor(
    private readonly repository: IdentityRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async signUp(input: SignUpInput): Promise<SignUpOutcome> {
    const existingUser = await this.repository.findUserByEmail(input.email);
    if (existingUser !== null) {
      return Object.freeze({ kind: "email_taken" });
    }

    const now = this.clock();
    const createdAt = nowIso(now);
    const digest = await createPasswordDigest(input.password);
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const issuedSession = await issueSessionToken();
    const sessionId = crypto.randomUUID();
    const expiresAt = expiryIso(now);

    await this.repository.createOwnerIdentity({
      userId,
      emailNormalized: input.email,
      organizationId,
      organizationName: input.organizationName,
      passwordSalt: digest.salt,
      passwordHash: digest.hash,
      passwordIterations: digest.iterations,
      createdAt
    });
    await this.repository.createSession({
      sessionId,
      userId,
      organizationId,
      tokenHash: issuedSession.tokenHash,
      expiresAt,
      createdAt
    });

    return Object.freeze({
      kind: "created",
      session: Object.freeze({ rawToken: issuedSession.rawToken, expiresAt })
    });
  }

  public async login(input: LoginInput): Promise<LoginOutcome> {
    const user = await this.repository.findUserByEmail(input.email);
    if (user === null || user.status !== "active") {
      return Object.freeze({ kind: "invalid_credentials" });
    }

    const credential = await this.repository.findCredentialByUserId(user.id);
    if (credential === null) {
      return Object.freeze({ kind: "invalid_credentials" });
    }

    const isPasswordValid = await verifyPassword(input.password, {
      algorithm: credential.algorithm,
      iterations: credential.iterations,
      salt: credential.passwordSalt,
      hash: credential.passwordHash
    });
    if (!isPasswordValid) {
      return Object.freeze({ kind: "invalid_credentials" });
    }

    const membership = await this.repository.findDefaultActiveMembership(user.id);
    if (membership === null) {
      return Object.freeze({ kind: "invalid_credentials" });
    }

    const now = this.clock();
    const createdAt = nowIso(now);
    const issuedSession = await issueSessionToken();
    const expiresAt = expiryIso(now);
    await this.repository.createSession({
      sessionId: crypto.randomUUID(),
      userId: user.id,
      organizationId: membership.organizationId,
      tokenHash: issuedSession.tokenHash,
      expiresAt,
      createdAt
    });

    return Object.freeze({
      kind: "authenticated",
      session: Object.freeze({ rawToken: issuedSession.rawToken, expiresAt })
    });
  }
}
