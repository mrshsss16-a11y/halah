import {
  approvedMessageRequestSchema,
  type ApprovedMessageRequest,
  type SendEligibility
} from "@hala/contracts";

export type ApprovedMessageInput = Readonly<{
  eligibility: SendEligibility;
  request: ApprovedMessageRequest;
}>;

export type ApprovedMessageResult =
  | Readonly<{ kind: "approved"; request: ApprovedMessageRequest }>
  | Readonly<{ kind: "blocked"; reasonCode: Exclude<SendEligibility["reasonCode"], "eligible"> }>;

export function createApprovedMessage(input: ApprovedMessageInput): ApprovedMessageResult {
  if (input.eligibility.kind === "ineligible") {
    return { kind: "blocked", reasonCode: input.eligibility.reasonCode };
  }

  return {
    kind: "approved",
    request: approvedMessageRequestSchema.parse(input.request)
  };
}
