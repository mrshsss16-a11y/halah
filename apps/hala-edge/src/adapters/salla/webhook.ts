import { verifyHmacSha256 } from "../../security/hmac";

export type SallaWebhookVerificationResult =
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "missing_security_strategy" }>
  | Readonly<{ kind: "unsupported_security_strategy"; strategy: string }>
  | Readonly<{ kind: "invalid_secret" }>
  | Readonly<{ kind: "invalid_signature" }>;

function readHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value !== undefined && value !== null && value.length > 0 ? value : null;
}

export async function verifySallaWebhookSignature(input: {
  rawBody: Uint8Array;
  headers: Headers;
  webhookSecret: string;
}): Promise<SallaWebhookVerificationResult> {
  const strategy = readHeader(input.headers, "x-salla-security-strategy");
  if (strategy === null) {
    return { kind: "missing_security_strategy" };
  }

  if (strategy.toLowerCase() !== "signature") {
    return { kind: "unsupported_security_strategy", strategy };
  }

  const verification = await verifyHmacSha256(
    input.rawBody,
    input.webhookSecret,
    readHeader(input.headers, "x-salla-signature") ?? undefined
  );

  switch (verification.kind) {
    case "valid":
      return { kind: "valid" };
    case "invalid_secret":
      return { kind: "invalid_secret" };
    case "invalid_signature":
      return { kind: "invalid_signature" };
  }
}
