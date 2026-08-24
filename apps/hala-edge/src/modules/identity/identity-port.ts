import type { OrganizationRole } from "@hala/contracts";

export type IdentityUser = Readonly<{
  id: string;
  emailNormalized: string;
  status: "active" | "disabled";
}>;

export type StoredCredential = Readonly<{
  userId: string;
  passwordSalt: string;
  passwordHash: string;
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
}>;

export type ActiveOrganizationMembership = Readonly<{
  organizationId: string;
}>;

export type ActiveSessionIdentity = Readonly<{
  sessionId: string;
  userId: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  expiresAt: string;
}>;

export type CreateIdentityRecord = Readonly<{
  userId: string;
  emailNormalized: string;
  organizationId: string;
  organizationName: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  createdAt: string;
}>;

export type CreateSessionRecord = Readonly<{
  sessionId: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}>;

export interface IdentityRepositoryPort {
  findUserByEmail(emailNormalized: string): Promise<IdentityUser | null>;
  findCredentialByUserId(userId: string): Promise<StoredCredential | null>;
  findDefaultActiveMembership(userId: string): Promise<ActiveOrganizationMembership | null>;
  createOwnerIdentity(record: CreateIdentityRecord): Promise<void>;
  createSession(input: CreateSessionRecord): Promise<void>;
}
