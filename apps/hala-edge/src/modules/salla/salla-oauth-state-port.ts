export type SallaOAuthStateRecord = Readonly<{
  id: string;
  organizationId: string;
  stateHash: string;
  expiresAt: string;
  createdAt: string;
}>;

export type ConsumeSallaOAuthStateOutcome =
  | Readonly<{ kind: "accepted"; organizationId: string }>
  | Readonly<{ kind: "missing_or_expired" }>
  | Readonly<{ kind: "already_consumed" }>;

export interface SallaOAuthStatePort {
  create(record: SallaOAuthStateRecord): Promise<void>;
  consume(
    input: Readonly<{ stateHash: string; now: string }>
  ): Promise<ConsumeSallaOAuthStateOutcome>;
}
