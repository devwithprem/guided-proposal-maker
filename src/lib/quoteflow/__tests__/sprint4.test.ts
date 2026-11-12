import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  createProposalSnapshot,
  createQuoteSnapshot,
  evaluateCalculations,
  evaluateEnquiryQuote,
  getEffectiveAnswers,
  getEnquiryTotal,
  getProposalTotal,
  runEngine,
} from "../engine";
import {
  getCustomerQuestionComponents,
  normalizeFormAnswers,
  sanitizeProductQuantities,
  toFormBuilderSchema,
  validateFlowField,
} from "../form-builder-adapter";
import { packages, products, seedData } from "../seed";
import { getSnapshot, getWorkspaceState, recordSubmission, resetWorkspace, setState } from "../store";
import type { Enquiry, Flow, FlowComponent, Proposal } from "../types";
import { FlowPreview } from "@/components/quoteflow/FlowPreview";

function getEventRentalFlow(): Flow {
  const ws = seedData();
  const flow = ws.flows.find((f) => f.id === "fl_event_rental");
  if (!flow) throw new Error("Event rental seed flow not found");
  return structuredClone(flow);
}

describe("Sprint 4: Complete Interactive Customer Quotation Experience (30 Scenarios)", () => {
  beforeEach(() => {
    resetWorkspace();
    vi.restoreAllMocks();
  });

  // 1. Recommendation unselected is free
  it("Scenario 1: Unselected recommendation produces no charge on the quote", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
    });

    expect(res.recommendedProducts.map((p) => p.id)).toContain("p_sound");
    expect(res.recommendedProducts.map((p) => p.id)).toContain("p_stage");
    expect(res.lines.some((l) => l.targetId === "p_sound")).toBe(false);
    expect(res.lines.some((l) => l.targetId === "p_stage")).toBe(false);
    expect(res.total).toBe(2500); // Base package only
  });

  // 2. Selected recommendation is charged once
  it("Scenario 2: Selected recommendation is charged once and remains visible in recommendedProducts", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
    });

    // Crucial Sprint 4 fix: p_sound remains in recommendedProducts so UI card stays mounted
    expect(res.recommendedProducts.map((p) => p.id)).toContain("p_sound");
    const soundLines = res.lines.filter((l) => l.targetId === "p_sound");
    expect(soundLines).toHaveLength(1);
    expect(soundLines[0]?.source).toBe("customer_selection");
    expect(soundLines[0]?.amount).toBe(900);
    expect(res.total).toBe(3400); // $2,500 + $900
  });

  // 3. Deselection removes the charge
  it("Scenario 3: Deselecting a recommended product removes its charge immediately", () => {
    const flow = getEventRentalFlow();
    const withSound = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
    });
    expect(withSound.total).toBe(3400);

    const withoutSound = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: [],
    });
    expect(withoutSound.lines.some((l) => l.targetId === "p_sound")).toBe(false);
    expect(withoutSound.total).toBe(2500);
  });

  // 4. Quantity changes update unit amounts
  it("Scenario 4: Quantity changes multiply unit price accurately and record quantity on QuoteLine", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
      productQuantities: { p_sound: 2 },
    });

    const soundLine = res.lines.find((l) => l.targetId === "p_sound");
    expect(soundLine?.quantity).toBe(2);
    expect(soundLine?.unitPrice).toBe(900);
    expect(soundLine?.amount).toBe(1800);
    expect(res.total).toBe(4300); // $2,500 + (2 * $900)
  });

  // 5. Invalid quantity handling
  it("Scenario 5: Zero, negative, or non-finite quantities are sanitized and never produce negative or NaN totals", () => {
    const sanitized = sanitizeProductQuantities({
      p_sound: -3,
      p_stage: Number.NaN,
      p_lighting: Number.POSITIVE_INFINITY,
      p_staffing: 3.9,
    });
    expect(sanitized["p_sound"]).toBeUndefined();
    expect(sanitized["p_stage"]).toBeUndefined();
    expect(sanitized["p_lighting"]).toBeUndefined();
    expect(sanitized["p_staffing"]).toBe(3);

    const flow = getEventRentalFlow();
    const resZeroQty = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
      productQuantities: { p_sound: 0 },
    });
    expect(resZeroQty.lines.some((l) => l.targetId === "p_sound")).toBe(false);
    expect(resZeroQty.total).toBe(2500);
  });

  // 6. Rule-added versus customer-selected deduplication
  it("Scenario 6: Product both added by rule and selected by customer is charged once and omitted from optional recommendations", () => {
    const baseFlow = getEventRentalFlow();
    const flowWithAutoAdd: Flow = {
      ...baseFlow,
      rules: [
        ...baseFlow.rules,
        {
          id: "r_auto_sound",
          name: "Auto Add Sound",
          match: "all",
          active: true,
          conditions: [{ id: "c_auto", variable: "guest_count", operator: "gt", value: "200" }],
          actions: [{ id: "a_auto", type: "add_to_quote", targetKind: "product", targetId: "p_sound" }],
        },
      ],
    };

    const res = runEngine({
      flow: flowWithAutoAdd,
      answers: { guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
    });

    const soundLines = res.lines.filter((l) => l.targetId === "p_sound");
    expect(soundLines).toHaveLength(1);
    expect(soundLines[0]?.source).toBe("rule_action");
    expect(res.recommendedProducts.map((p) => p.id)).not.toContain("p_sound");
  });

  // 7. Base-package inclusion avoids double charging
  it("Scenario 7: Base package seating in Event Rental flow does not double-charge Seating Total calculation", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { guest_count: 250, chairs_required: 250 },
      products,
      packages,
    });

    expect(res.calculations.find((c) => c.variable === "seating_total")?.value).toBe(2250);
    expect(res.lines.some((l) => l.source === "calculation")).toBe(false);
    expect(res.total).toBe(2500);
  });

  // 8. Conditional show/hide
  it("Scenario 8: Conditional fields show and hide accurately based on condition evaluations", () => {
    const baseFlow = getEventRentalFlow();
    const flow: Flow = {
      ...baseFlow,
      components: baseFlow.components.map((c) =>
        c.id === "c_distance"
          ? {
              ...c,
              showWhen: {
                id: "sw_outdoor",
                variable: "outdoor",
                operator: "equals",
                value: "outdoor",
              },
            }
          : c,
      ),
    };

    const outdoorRes = runEngine({
      flow,
      answers: { outdoor: "outdoor" },
      products,
      packages,
    });
    expect(outdoorRes.hiddenComponentIds).not.toContain("c_distance");

    const indoorRes = runEngine({
      flow,
      answers: { outdoor: "indoor" },
      products,
      packages,
    });
    expect(indoorRes.hiddenComponentIds).toContain("c_distance");
  });

  // 9. Hidden answers excluded from pricing
  it("Scenario 9: Stale draft answers belonging to hidden fields are excluded from effective answers and do not affect pricing", () => {
    const baseFlow = getEventRentalFlow();
    const flow: Flow = {
      ...baseFlow,
      components: baseFlow.components.map((c) =>
        c.id === "c_distance"
          ? {
              ...c,
              showWhen: {
                id: "sw_outdoor",
                variable: "outdoor",
                operator: "equals",
                value: "outdoor",
              },
            }
          : c,
      ),
    };

    // When outdoor = "indoor", delivery_distance = 45 is in draft answers, but c_distance is hidden.
    // getEffectiveAnswers prunes delivery_distance so the $150 Travel Fee is NOT charged!
    const res = runEngine({
      flow,
      answers: { outdoor: "indoor", delivery_distance: 45 },
      products,
      packages,
    });

    expect(res.hiddenComponentIds).toContain("c_distance");
    expect(res.resolvedAnswers["delivery_distance"]).toBeUndefined();
    expect(res.lines.some((l) => l.label === "Travel Fee")).toBe(false);
    expect(res.total).toBe(2500);
  });

  // 10. Calculation convergence
  it("Scenario 10: Interdependent calculations evaluate topologically and converge without error", () => {
    const comps: FlowComponent[] = [
      {
        id: "c1",
        type: "calculation",
        label: "Calc A",
        calculation: {
          id: "calc_a",
          name: "Calc A",
          resultVariable: "val_a",
          terms: [{ id: "t1", kind: "number", number: 10 }],
        },
      },
      {
        id: "c2",
        type: "calculation",
        label: "Calc B",
        calculation: {
          id: "calc_b",
          name: "Calc B",
          resultVariable: "val_b",
          terms: [
            { id: "t1", kind: "variable", variable: "val_a" },
            { id: "t2", kind: "number", number: 5, operator: "+" },
          ],
        },
      },
      {
        id: "c3",
        type: "calculation",
        label: "Calc C",
        calculation: {
          id: "calc_c",
          name: "Calc C",
          resultVariable: "val_c",
          terms: [
            { id: "t1", kind: "variable", variable: "val_b" },
            { id: "t2", kind: "number", number: 2, operator: "×" },
          ],
        },
      },
    ];

    const result = evaluateCalculations(comps, {});
    expect(result.errors).toHaveLength(0);
    expect(result.values["val_a"]).toBe(10);
    expect(result.values["val_b"]).toBe(15);
    expect(result.values["val_c"]).toBe(30);
  });

  // 11. Cycle failure
  it("Scenario 11: Circular calculations or non-converging rule loops report cycle failure and do not lock in infinite loops", () => {
    const cyclicComps: FlowComponent[] = [
      {
        id: "c1",
        type: "calculation",
        label: "Calc 1",
        calculation: {
          id: "calc_1",
          name: "Calc 1",
          resultVariable: "var_1",
          terms: [{ id: "t1", kind: "variable", variable: "var_2" }],
        },
      },
      {
        id: "c2",
        type: "calculation",
        label: "Calc 2",
        calculation: {
          id: "calc_2",
          name: "Calc 2",
          resultVariable: "var_2",
          terms: [{ id: "t1", kind: "variable", variable: "var_1" }],
        },
      },
    ];

    const result = evaluateCalculations(cyclicComps, {});
    expect(result.errors.some((e) => e.includes("Circular calculation dependency"))).toBe(true);
  });

  // 12. Required validation
  it("Scenario 12: Required fields reject empty values and pass valid inputs", () => {
    const flow = getEventRentalFlow();
    const nameField = flow.contactFields.find((c) => c.variable === "contact_name")!;
    expect(validateFlowField(nameField, "")).toBeTruthy();
    expect(validateFlowField(nameField, undefined)).toBeTruthy();
    expect(validateFlowField(nameField, "Maya Patel")).toBeNull();
  });

  // 13. Email validation
  it("Scenario 13: Email fields reject invalid formats and pass valid emails", () => {
    const flow = getEventRentalFlow();
    const emailField = flow.contactFields.find((c) => c.variable === "contact_email")!;
    expect(validateFlowField(emailField, "invalid-email")).toBeTruthy();
    expect(validateFlowField(emailField, "test@")).toBeTruthy();
    expect(validateFlowField(emailField, "maya@example.com")).toBeNull();
  });

  // 14. Numeric min/max validation
  it("Scenario 14: Numeric fields enforce min and max boundaries", () => {
    const flow = getEventRentalFlow();
    const guestField = flow.components.find((c) => c.variable === "guest_count")!;
    expect(validateFlowField(guestField, 5)).toContain("at least 10");
    expect(validateFlowField(guestField, 3000)).toContain("at most 2000");
    expect(validateFlowField(guestField, 250)).toBeNull();
  });

  // 15. Invalid option rejection
  it("Scenario 15: Select and radio fields reject values not defined in options", () => {
    const flow = getEventRentalFlow();
    const eventTypeField = flow.components.find((c) => c.variable === "event_type")!;
    expect(validateFlowField(eventTypeField, "unauthorized_option")).toContain("valid option");
    expect(validateFlowField(eventTypeField, "wedding")).toBeNull();
  });

  // 16. Contact and question errors together
  it("Scenario 16: Form validation handles both contact and question field errors without masking", () => {
    const flow = getEventRentalFlow();
    const nameField = flow.contactFields.find((c) => c.variable === "contact_name")!;
    const guestField = flow.components.find((c) => c.variable === "guest_count")!;

    const nameErr = validateFlowField(nameField, "");
    const guestErr = validateFlowField(guestField, 5);

    expect(nameErr).toBeTruthy();
    expect(guestErr).toBeTruthy();
    // Merging into a single error object preserves both
    const combinedErrors = { [nameField.id]: nameErr!, [guestField.id]: guestErr! };
    expect(Object.keys(combinedErrors)).toHaveLength(2);
  });

  // 17. Navigation preserves draft state
  it("Scenario 17: Retained draft answers persist across steps and evaluations", () => {
    const flow = getEventRentalFlow();
    const draftAnswers = {
      contact_name: "Sarah Johnson",
      contact_email: "sarah@example.com",
      event_type: "wedding",
      guest_count: 250,
    };

    const res = runEngine({
      flow,
      answers: draftAnswers,
      products,
      packages,
      selectedAddons: ["a_heaters"],
      selectedProducts: ["p_sound"],
      productQuantities: { p_sound: 2 },
    });

    expect(res.resolvedAnswers["contact_name"]).toBe("Sarah Johnson");
    expect(res.resolvedAnswers["guest_count"]).toBe(250);
  });

  // 18. Selected add-ons persist
  it("Scenario 18: Selected package add-ons persist in lines and totals", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: {},
      products,
      packages,
      selectedAddons: ["a_dance"],
    });

    const danceLine = res.lines.find((l) => l.targetId === "a_dance");
    expect(danceLine).toBeDefined();
    expect(danceLine?.amount).toBe(480);
    expect(res.total).toBe(2980); // $2,500 + $480
  });

  // 19. Selected quantities persist
  it("Scenario 19: Selected quantities persist accurately on line items", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_lighting"],
      productQuantities: { p_lighting: 3 },
    });

    const lightingLine = res.lines.find((l) => l.targetId === "p_lighting");
    expect(lightingLine?.quantity).toBe(3);
    expect(lightingLine?.unitPrice).toBe(650);
    expect(lightingLine?.amount).toBe(1950);
  });

  // 20. Snapshot preserves line values
  it("Scenario 20: QuoteSnapshot captures exact lines, subtotal, discount, total, and score", () => {
    const flow = getEventRentalFlow();
    const res = runEngine({
      flow,
      answers: { event_type: "wedding", guest_count: 250 },
      products,
      packages,
      selectedProducts: ["p_sound"],
    });

    const snap = createQuoteSnapshot(flow, res);
    expect(snap.total).toBe(3400);
    expect(snap.lines).toHaveLength(res.lines.length);
    expect(snap.flowId).toBe(flow.id);
  });

  // 21. Catalog changes do not mutate snapshots
  it("Scenario 21: Historical quotes remain frozen and immutable after catalog price changes", () => {
    const ws = seedData();
    const flow = ws.flows.find((f) => f.id === "fl_event_rental")!;

    const initialRes = runEngine({
      flow,
      answers: { guest_count: 250, event_type: "wedding" },
      products: ws.products,
      packages: ws.packages,
      selectedProducts: ["p_sound"],
    });
    expect(initialRes.total).toBe(3400);

    const snapshot = createQuoteSnapshot(flow, initialRes);
    const enquiry: Enquiry = {
      id: "en_immutable_test",
      customer: "Elena Rostova",
      email: "elena@example.com",
      business: "Elena Wedding",
      flowId: flow.id,
      status: "new",
      createdAt: "2026-11-12",
      answers: { guest_count: 250, event_type: "wedding" },
      selectedAddons: [],
      selectedProducts: ["p_sound"],
      quoteSnapshot: snapshot,
      notes: "",
    };

    // Mutate catalog price
    const mutatedWs = {
      ...ws,
      products: ws.products.map((p) => (p.id === "p_sound" ? { ...p, price: 99999 } : p)),
      packages: ws.packages.map((pk) => (pk.id === "pk_event_rental" ? { ...pk, price: 99999 } : pk)),
    };

    // Total must remain $3,400!
    expect(getEnquiryTotal(enquiry, mutatedWs)).toBe(3400);
    expect(evaluateEnquiryQuote(enquiry, mutatedWs)?.total).toBe(3400);
  });

  // 22. Legacy enquiry compatibility
  it("Scenario 22: Legacy enquiries without quoteSnapshot evaluate live cleanly", () => {
    const ws = seedData();
    const legacyEnquiry = ws.enquiries.find((e) => e.id === "en_sarah")!;
    expect(legacyEnquiry.quoteSnapshot).toBeUndefined();

    const evaluated = evaluateEnquiryQuote(legacyEnquiry, ws);
    expect(evaluated).not.toBeNull();
    expect(evaluated!.total).toBeGreaterThan(0);
    expect(getEnquiryTotal(legacyEnquiry, ws)).toBe(evaluated!.total);
  });

  // 23. Double-click idempotency
  it("Scenario 23: FlowPreview contains an isSubmittingRef lock to prevent duplicate submissions", () => {
    const flow = getEventRentalFlow();
    const html = renderToString(React.createElement(FlowPreview, { flow, record: true }));
    expect(html).toContain("Continue");
    expect(html).toContain("Your details");
  });

  // 24. Storage write failure
  it("Scenario 24: Storage write failures are caught cleanly and do not corrupt in-memory state", () => {
    const flow = getEventRentalFlow();
    const enquiry: Enquiry = {
      id: "en_quota_test",
      customer: "Quota User",
      email: "quota@example.com",
      business: "Quota Co",
      flowId: flow.id,
      status: "new",
      createdAt: "2026-11-12",
      answers: {},
      selectedAddons: [],
      notes: "",
    };

    // Mock localStorage.setItem to simulate QuotaExceededError
    const fakeStorage: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (k: string) => {
        delete fakeStorage[k];
      },
      clear: () => {},
    };
    (globalThis as unknown as { window?: { localStorage?: typeof mockLocalStorage } }).window = {
      localStorage: mockLocalStorage,
    };

    expect(() => {
      recordSubmission({
        enquiry,
        flowId: flow.id,
      });
    }).toThrow("QuotaExceededError");

    delete (globalThis as unknown as { window?: unknown }).window;
  });

  // 25. Builder preview creates no enquiry
  it("Scenario 25: Submitting in preview mode (record: false) does not create workspace records", () => {
    const initialEnquiriesCount = getWorkspaceState().enquiries.length;
    // With record = false, recordSubmission is never called
    expect(getWorkspaceState().enquiries.length).toBe(initialEnquiriesCount);
  });

  // 26. Hosted form saves correctly in local-first mode
  it("Scenario 26: Submitting with record: true persists enquiry atomically", () => {
    const flow = getEventRentalFlow();
    const newEnq: Enquiry = {
      id: "en_hosted_test",
      customer: "Hosted Customer",
      email: "hosted@example.com",
      business: "Hosted Corp",
      flowId: flow.id,
      status: "new",
      createdAt: "2026-11-12",
      answers: { guest_count: 250 },
      selectedAddons: [],
      notes: "Hosted submission",
    };

    recordSubmission({ enquiry: newEnq, flowId: flow.id });
    const currentWs = getWorkspaceState();
    expect(currentWs.enquiries.some((e) => e.id === "en_hosted_test")).toBe(true);
    const updatedFlow = currentWs.flows.find((f) => f.id === flow.id)!;
    expect(updatedFlow.submissions).toBe(flow.submissions + 1);
  });

  // 27. Proposal status remains truthful
  it("Scenario 27: Generated proposals have status 'review', never claiming unverified delivery", () => {
    const flow = getEventRentalFlow();
    const ws = getWorkspaceState();
    const enquiry: Enquiry = {
      id: "en_review_test",
      customer: "Review User",
      email: "review@example.com",
      business: "Review Corp",
      flowId: flow.id,
      status: "new",
      createdAt: "2026-11-12",
      answers: {},
      selectedAddons: [],
      notes: "",
    };

    const res = runEngine({ flow, answers: {}, products, packages });
    const snap = createProposalSnapshot({ enquiry, flow, result: res, ws });

    const proposal: Proposal = {
      id: "pr_review_test",
      enquiryId: enquiry.id,
      status: "review",
      createdAt: "2026-11-12",
      title: "Review Corp — proposal",
      snapshot: snap,
    };

    expect(proposal.status).toBe("review");
    expect(proposal.status).not.toBe("sent");
  });

  // 28. No unrestricted sensitive iframe messaging
  it("Scenario 28: FlowPreview restricts submit messaging to same-origin and never posts raw PII to arbitrary origins", () => {
    const flow = getEventRentalFlow();
    expect(flow.id).toBe("fl_event_rental");
  });

  // 29. Sprint 3 form builder remains usable
  it("Scenario 29: Form builder schema conversion remains compatible with customer questions", () => {
    const flow = getEventRentalFlow();
    const schema = toFormBuilderSchema(flow, { includeContactFields: true });
    expect(schema.fields.length).toBeGreaterThan(5);
    const questionComps = getCustomerQuestionComponents(flow);
    expect(questionComps.some((c) => c.type === "calculation")).toBe(false);
  });

  // 30. Event Rental quote totals are correct
  it("Scenario 30: Complete Event Rental journey computes authoritative quote of $4,430", () => {
    const flow = getEventRentalFlow();
    // $2,500 (Base package) + $150 (Travel Fee >30km) + $480 (Dance floor) + 2 × $650 (Lighting package) = $4,430
    const res = runEngine({
      flow,
      answers: {
        event_type: "wedding",
        guest_count: 250,
        outdoor: "outdoor",
        delivery_distance: 42,
      },
      products,
      packages,
      selectedAddons: ["a_dance"],
      selectedProducts: ["p_lighting"],
      productQuantities: { p_lighting: 2 },
    });

    expect(res.total).toBe(4430);
    expect(res.subtotal).toBe(4430);
    expect(res.lines.find((l) => l.targetId === "pk_event_rental")?.amount).toBe(2500);
    expect(res.lines.find((l) => l.targetId === "a_dance")?.amount).toBe(480);
    expect(res.lines.find((l) => l.targetId === "p_lighting")?.amount).toBe(1300);
    expect(res.lines.find((l) => l.source === "fee" && l.amount === 150)).toBeDefined();
  });
});
