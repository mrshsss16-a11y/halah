import { z } from "zod";

export const environmentSchema = z.enum(["development", "staging", "production"]);
export type Environment = z.infer<typeof environmentSchema>;

export const organizationIdSchema = z.string().uuid();
export const recoveryCaseIdSchema = z.string().uuid();
export const eventIdSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const nonEmptyTextSchema = z.string().trim().min(1).max(500);

export const recoveryStatusSchema = z.enum([
  "received",
  "qualified",
  "scheduled",
  "sent",
  "suppressed",
  "purchased",
  "failed",
  "cancelled"
]);
export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>;

export const terminalRecoveryStatusSchema = z.enum([
  "suppressed",
  "purchased",
  "failed",
  "cancelled"
]);
export type TerminalRecoveryStatus = z.infer<typeof terminalRecoveryStatusSchema>;

export const recoveryReasonCodeSchema = z.enum([
  "eligible",
  "policy_disabled",
  "missing_consent",
  "contact_suppressed",
  "cart_completed",
  "attempt_cap_reached",
  "organization_budget_exceeded",
  "template_not_approved",
  "duplicate_event",
  "invalid_transition",
  "unknown"
]);
export type RecoveryReasonCode = z.infer<typeof recoveryReasonCodeSchema>;

export const recoveryPolicySchema = z
  .object({
    policyId: z.string().uuid(),
    version: z.number().int().positive(),
    isActive: z.literal(true),
    allowsRecovery: z.boolean(),
    maxAttemptsPerCase: z.number().int().min(1).max(3),
    maxMessagesPerContactWindow: z.number().int().min(1).max(5),
    replyBudgetPerCase: z.number().int().min(0).max(3)
  })
  .strict();
export type RecoveryPolicy = z.infer<typeof recoveryPolicySchema>;

export const recoveryCaseSchema = z
  .object({
    recoveryCaseId: recoveryCaseIdSchema,
    organizationId: organizationIdSchema,
    cartId: nonEmptyTextSchema,
    contactReference: z.string().trim().min(16).max(128),
    status: recoveryStatusSchema,
    attemptCount: z.number().int().min(0).max(3),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema
  })
  .strict();
export type RecoveryCase = z.infer<typeof recoveryCaseSchema>;

export const eligibilityInputSchema = z
  .object({
    recoveryCase: recoveryCaseSchema,
    policy: recoveryPolicySchema,
    hasConsent: z.boolean(),
    isSuppressed: z.boolean(),
    isCartCompleted: z.boolean(),
    isWithinOrganizationBudget: z.boolean(),
    isTemplateApproved: z.boolean()
  })
  .strict();
export type EligibilityInput = z.infer<typeof eligibilityInputSchema>;

export const sendEligibilitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("eligible"),
      reasonCode: z.literal("eligible")
    })
    .strict(),
  z
    .object({
      kind: z.literal("ineligible"),
      reasonCode: recoveryReasonCodeSchema.exclude(["eligible"])
    })
    .strict()
]);
export type SendEligibility = z.infer<typeof sendEligibilitySchema>;

export const recoverySimulationInputSchema = z
  .object({
    allowsRecovery: z.boolean(),
    hasConsent: z.boolean(),
    isSuppressed: z.boolean(),
    isCartCompleted: z.boolean(),
    isWithinOrganizationBudget: z.boolean(),
    isTemplateApproved: z.boolean(),
    attemptCount: z.number().int().min(0).max(3),
    maxAttemptsPerCase: z.number().int().min(1).max(3)
  })
  .strict();
export type RecoverySimulationInput = z.infer<typeof recoverySimulationInputSchema>;

export const approvedMessageRequestSchema = z
  .object({
    organizationId: organizationIdSchema,
    recoveryCaseId: recoveryCaseIdSchema,
    idempotencyKey: z.string().uuid(),
    templateId: nonEmptyTextSchema,
    category: z.literal("marketing"),
    checkoutUrl: z.string().url().max(2048),
    policyId: z.string().uuid(),
    policyVersion: z.number().int().positive()
  })
  .strict();
export type ApprovedMessageRequest = z.infer<typeof approvedMessageRequestSchema>;

export const deliveryStatusSchema = z.enum(["queued", "sent", "delivered", "failed"]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliveryUpdateSchema = z
  .object({
    providerMessageId: nonEmptyTextSchema,
    organizationId: organizationIdSchema,
    recoveryCaseId: recoveryCaseIdSchema,
    status: deliveryStatusSchema,
    category: z.literal("marketing"),
    deliveredAt: isoTimestampSchema.optional(),
    failureCode: z.string().trim().min(1).max(100).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "delivered" && value.deliveredAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deliveredAt is required when a message is delivered",
        path: ["deliveredAt"]
      });
    }
    if (value.status === "failed" && value.failureCode === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failureCode is required when a message fails",
        path: ["failureCode"]
      });
    }
  });
export type DeliveryUpdate = z.infer<typeof deliveryUpdateSchema>;

export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    environment: environmentSchema,
    requestId: z.string().uuid(),
    version: z.string().min(1)
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(250),
      requestId: z.string().uuid()
    })
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const userIdSchema = z.string().uuid();
export const sessionIdSchema = z.string().uuid();
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const organizationRoleSchema = z.enum(["owner", "operator", "reviewer", "viewer"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const passwordSchema = z
  .string()
  .min(12, "كلمة المرور يجب أن تتكون من 12 رمزاً على الأقل.")
  .max(128, "كلمة المرور طويلة جداً.");

export const signUpInputSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    organizationName: z.string().trim().min(2).max(120)
  })
  .strict();
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const loginInputSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128)
  })
  .strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

export const userSessionSchema = z
  .object({
    sessionId: sessionIdSchema,
    userId: userIdSchema,
    organizationId: organizationIdSchema,
    role: organizationRoleSchema,
    expiresAt: isoTimestampSchema
  })
  .strict();
export type UserSession = z.infer<typeof userSessionSchema>;

export const activationServiceSchema = z.enum(["product_content", "cart_recovery", "both"]);
export type ActivationService = z.infer<typeof activationServiceSchema>;

export const activationRequestInputSchema = z
  .object({
    requestedService: activationServiceSchema,
    notes: z.string().trim().max(1000).default("")
  })
  .strict();
export type ActivationRequestInput = z.infer<typeof activationRequestInputSchema>;

export const activationRequestStatusSchema = z.enum([
  "submitted",
  "reviewing",
  "approved",
  "declined",
  "cancelled"
]);
export type ActivationRequestStatus = z.infer<typeof activationRequestStatusSchema>;

export const productContentImportStatusSchema = z.enum([
  "received",
  "validated",
  "needs_evidence",
  "ready_for_generation",
  "failed"
]);
export type ProductContentImportStatus = z.infer<typeof productContentImportStatusSchema>;

export const productContentImportInputSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(120),
    csvText: z.string().min(1).max(1_000_000)
  })
  .strict();
export type ProductContentImportInput = z.infer<typeof productContentImportInputSchema>;

export const productFactEvidenceApprovalInputSchema = z
  .object({
    reviewNote: z.string().trim().max(1000).default("")
  })
  .strict();
export type ProductFactEvidenceApprovalInput = z.infer<
  typeof productFactEvidenceApprovalInputSchema
>;

export const productContentDraftStatusSchema = z.enum([
  "draft",
  "needs_revision",
  "ready_for_review",
  "approved_for_preview",
  "exported_to_staging",
  "rejected"
]);
export type ProductContentDraftStatus = z.infer<typeof productContentDraftStatusSchema>;

export const productContentDraftEvidenceSchema = z
  .object({
    claim: z.string().trim().min(1).max(300),
    factKey: z.string().trim().min(1).max(120)
  })
  .strict();
export type ProductContentDraftEvidence = z.infer<typeof productContentDraftEvidenceSchema>;

export const productContentManualDraftInputSchema = z
  .object({
    factId: z.string().uuid(),
    title: z.string().trim().min(3).max(120),
    shortDescription: z.string().trim().min(20).max(300),
    longDescription: z.string().trim().min(60).max(3000),
    metaDescription: z.string().trim().min(30).max(180),
    evidence: z.array(productContentDraftEvidenceSchema).min(1).max(50)
  })
  .strict();
export type ProductContentManualDraftInput = z.infer<typeof productContentManualDraftInputSchema>;

export const productContentDraftReviewInputSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().max(1000).default("")
  })
  .strict();
export type ProductContentDraftReviewInput = z.infer<typeof productContentDraftReviewInputSchema>;

export const productContentExportStageInputSchema = z
  .object({
    confirmation: z.literal("stage_for_export"),
    draftIds: z
      .array(z.string().uuid())
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "يجب أن تكون معرفات المسودات فريدة."
      })
  })
  .strict();
export type ProductContentExportStageInput = z.infer<typeof productContentExportStageInputSchema>;

export const visionObservationStatusSchema = z.enum([
  "draft",
  "reviewed",
  "needs_evidence",
  "rejected"
]);
export type VisionObservationStatus = z.infer<typeof visionObservationStatusSchema>;

export const commercialDashboardSchema = z
  .object({
    organizationName: z.string().min(1).max(120),
    connectionStatus: z.enum(["not_connected", "pending", "active"]),
    productContentStatus: z.enum(["not_started", "needs_evidence", "ready_for_review"]),
    recoveryStatus: z.enum(["not_configured", "policy_review", "ready_for_staging"]),
    activationStatus: activationRequestStatusSchema.nullable()
  })
  .strict();
export type CommercialDashboard = z.infer<typeof commercialDashboardSchema>;

export const sallaOAuthMockCompletionInputSchema = z
  .object({
    state: z.string().trim().min(40).max(256)
  })
  .strict();
export type SallaOAuthMockCompletionInput = z.infer<typeof sallaOAuthMockCompletionInputSchema>;

export const recoveryLocalIntakeInputSchema = z
  .object({
    externalCartId: z.string().trim().min(1).max(200),
    contactHash: z.string().trim().min(16).max(128)
  })
  .strict();
export type RecoveryLocalIntakeInput = z.infer<typeof recoveryLocalIntakeInputSchema>;

export const auditEventQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(5).max(50).default(25),
    action: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]+$/u)
      .max(100)
      .optional()
  })
  .strict();
export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>;

export const auditEventListItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.string().min(1).max(100),
    entityType: z.string().min(1).max(100),
    entityId: z.string().min(1).max(200),
    requestId: z.string().uuid(),
    reasonCode: z.string().min(1).max(250).nullable(),
    createdAt: isoTimestampSchema
  })
  .strict();
export type AuditEventListItem = z.infer<typeof auditEventListItemSchema>;

export const auditEventListResponseSchema = z
  .object({
    items: z.array(auditEventListItemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    action: z.string().nullable()
  })
  .strict();
export type AuditEventListResponse = z.infer<typeof auditEventListResponseSchema>;

export const teamAssignableRoleSchema = z.enum(["operator", "reviewer", "viewer"]);
export type TeamAssignableRole = z.infer<typeof teamAssignableRoleSchema>;

export const teamMemberRoleUpdateSchema = z
  .object({
    role: organizationRoleSchema
  })
  .strict();
export type TeamMemberRoleUpdate = z.infer<typeof teamMemberRoleUpdateSchema>;

export const teamInvitationCreateSchema = z
  .object({
    email: emailSchema,
    role: teamAssignableRoleSchema
  })
  .strict();
export type TeamInvitationCreate = z.infer<typeof teamInvitationCreateSchema>;

export const teamInvitationAcceptSchema = z
  .object({
    token: z.string().trim().min(40).max(256)
  })
  .strict();
export type TeamInvitationAccept = z.infer<typeof teamInvitationAcceptSchema>;

export const teamMemberSchema = z
  .object({
    userId: userIdSchema,
    email: emailSchema,
    role: organizationRoleSchema,
    createdAt: isoTimestampSchema
  })
  .strict();
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamInvitationSchema = z
  .object({
    id: z.string().uuid(),
    email: emailSchema,
    role: teamAssignableRoleSchema,
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
    expiresAt: isoTimestampSchema,
    createdAt: isoTimestampSchema
  })
  .strict();
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;

export const organizationTeamSchema = z
  .object({
    members: z.array(teamMemberSchema),
    invitations: z.array(teamInvitationSchema)
  })
  .strict();
export type OrganizationTeam = z.infer<typeof organizationTeamSchema>;

export const organizationSwitchSchema = z
  .object({
    organizationId: organizationIdSchema
  })
  .strict();
export type OrganizationSwitch = z.infer<typeof organizationSwitchSchema>;
