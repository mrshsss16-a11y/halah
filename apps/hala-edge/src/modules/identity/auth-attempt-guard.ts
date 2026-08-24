export type AuthAttemptOperation = "login" | "signup";

export type ConsumeAuthAttemptInput = Readonly<{
  operation: AuthAttemptOperation;
  email: string;
  clientAddress: string;
}>;

export type AuthAttemptOutcome =
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "limited"; retryAfterSeconds: number }>
  | Readonly<{ kind: "unavailable" }>;

export interface AuthAttemptGuardPort {
  consume(input: ConsumeAuthAttemptInput): Promise<AuthAttemptOutcome>;
}
