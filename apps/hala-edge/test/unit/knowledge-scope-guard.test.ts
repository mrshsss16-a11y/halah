import { describe, expect, it } from "vitest";
import {
  KnowledgeScopeGuard,
  type KnowledgeCandidate
} from "../../src/modules/knowledge/knowledge-scope-guard";

const scope = { organizationId: "org-a", storeConnectionId: "store-a" } as const;
const base: KnowledgeCandidate = {
  id: "item-1",
  organizationId: "org-a",
  storeConnectionId: "store-a",
  kind: "policy",
  status: "active",
  canonicalText: "policy",
  sourceReference: "d1:policy-1",
  effectiveFrom: null,
  effectiveUntil: null
};

describe("KnowledgeScopeGuard", () => {
  it("allows active tenant knowledge and global style only", () => {
    const guard = new KnowledgeScopeGuard(() => new Date("2026-09-03T00:00:00.000Z"));
    const globalStyle = {
      ...base,
      id: "style-1",
      organizationId: null,
      storeConnectionId: null,
      kind: "style" as const,
      canonicalText: "style"
    };
    expect(guard.requireEvidence([base, globalStyle], scope).map((item) => item.id)).toEqual([
      "item-1",
      "style-1"
    ]);
  });

  it("rejects another tenant even when the text is similar", () => {
    const guard = new KnowledgeScopeGuard();
    const otherTenant = { ...base, organizationId: "org-b", storeConnectionId: "store-b" };
    expect(guard.filter([otherTenant], scope)).toEqual([]);
    expect(() => guard.requireEvidence([otherTenant], scope)).toThrow("knowledge_evidence_missing");
  });

  it("rejects inactive and expired evidence", () => {
    const guard = new KnowledgeScopeGuard(() => new Date("2026-09-03T00:00:00.000Z"));
    const expired = { ...base, id: "expired", effectiveUntil: "2026-09-02T00:00:00.000Z" };
    const draft = { ...base, id: "draft", status: "draft" as const };
    expect(guard.filter([expired, draft], scope)).toEqual([]);
  });

  it("does not allow tenant facts to be marked global style", () => {
    const guard = new KnowledgeScopeGuard();
    const invalidGlobal = {
      ...base,
      kind: "style" as const,
      organizationId: "org-a",
      storeConnectionId: "store-a"
    };
    expect(guard.filter([invalidGlobal], scope)).toEqual([]);
  });
});
