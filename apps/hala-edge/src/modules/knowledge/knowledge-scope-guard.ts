export type KnowledgeScope = Readonly<{
  organizationId: string;
  storeConnectionId: string;
}>;

export type KnowledgeCandidate = Readonly<{
  id: string;
  organizationId: string | null;
  storeConnectionId: string | null;
  kind: "style" | "policy" | "faq" | "product" | "safety_rule";
  status: "draft" | "approved" | "active" | "retired";
  canonicalText: string;
  sourceReference: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}>;

function isEffective(candidate: KnowledgeCandidate, now: string): boolean {
  return (
    candidate.status === "active" &&
    (candidate.effectiveFrom === null || candidate.effectiveFrom <= now) &&
    (candidate.effectiveUntil === null || candidate.effectiveUntil > now)
  );
}

function isAllowed(candidate: KnowledgeCandidate, scope: KnowledgeScope): boolean {
  if (candidate.kind === "style") {
    return candidate.organizationId === null && candidate.storeConnectionId === null;
  }
  return (
    candidate.organizationId === scope.organizationId &&
    candidate.storeConnectionId === scope.storeConnectionId
  );
}

export class KnowledgeScopeGuard {
  public constructor(private readonly clock: () => Date = () => new Date()) {}

  public filter(
    candidates: readonly KnowledgeCandidate[],
    scope: KnowledgeScope
  ): readonly KnowledgeCandidate[] {
    if (!scope.organizationId || !scope.storeConnectionId)
      throw new Error("knowledge_scope_required");
    const now = this.clock().toISOString();
    return candidates.filter(
      (candidate) => isEffective(candidate, now) && isAllowed(candidate, scope)
    );
  }

  public requireEvidence(
    candidates: readonly KnowledgeCandidate[],
    scope: KnowledgeScope
  ): readonly KnowledgeCandidate[] {
    const allowed = this.filter(candidates, scope);
    if (allowed.length === 0) throw new Error("knowledge_evidence_missing");
    return allowed;
  }
}
