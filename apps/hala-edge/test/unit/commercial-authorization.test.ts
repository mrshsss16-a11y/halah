import { describe, expect, it } from "vitest";
import {
  canManageStoreConnection,
  canMutateProductContent,
  canReviewProductContent,
  canStageProductContentExport
} from "../../src/http/commercial-authorization";

describe("commercial authorization", () => {
  it("allows owner and operator roles to mutate product content", () => {
    expect(canMutateProductContent("owner")).toBe(true);
    expect(canMutateProductContent("operator")).toBe(true);
  });

  it("keeps the viewer role read-only", () => {
    expect(canMutateProductContent("viewer")).toBe(false);
  });

  it("allows reviewer to approve content without granting content authoring", () => {
    expect(canReviewProductContent("owner")).toBe(true);
    expect(canReviewProductContent("operator")).toBe(true);
    expect(canReviewProductContent("reviewer")).toBe(true);
    expect(canReviewProductContent("viewer")).toBe(false);
    expect(canMutateProductContent("reviewer")).toBe(false);
  });

  it("limits export staging to the organization owner", () => {
    expect(canStageProductContentExport("owner")).toBe(true);
    expect(canStageProductContentExport("operator")).toBe(false);
    expect(canStageProductContentExport("viewer")).toBe(false);
  });

  it("limits Salla connection management to the organization owner", () => {
    expect(canManageStoreConnection("owner")).toBe(true);
    expect(canManageStoreConnection("operator")).toBe(false);
    expect(canManageStoreConnection("viewer")).toBe(false);
  });
});
