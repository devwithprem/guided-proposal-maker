import { describe, expect, it } from "vitest";
import { withFlowDefaults } from "../defaults";
import {
  createProposalSnapshot,
  createQuoteSnapshot,
  evaluateCalculations,
  evaluateCondition,
  evaluateEnquiryQuote,
  evaluateRule,
  renameCalculationResultVariable,
  renameFlowOptionValue,
  renameFlowVariable,
  runCalculation,
  runEngine,
} from "../engine";
import { packages, products, seedData, uid } from "../seed";
import type { Flow, FlowComponent, Package, Product, Rule } from "../types";

function createTestFlow(overrides: Partial<Flow> = {}): Flow {
  return withFlowDefaults({
    id: "test_flow",
    name: "Test Flow",
    description: "Flow for unit tests",
    status: "live",
    submissions: 0,
    updatedAt: new Date().toISOString(),
    components: [
      { id: "c_guests", type: "number", label: "Guest Count", variable: "guests" },
      {
        id: "c_tier",
        type: "radio",
        label: "Service Tier",
        variable: "tier",
        options: [
          { id: "opt_standard", label: "Standard", value: "standard" },
          { id: "opt_premium", label: "Premium", value: "premium" },
        ],
      },
    ],
    rules: [],
    ...overrides,
  });
}

describe("QuoteFlow Business Engine (Sprint 2)", () => {
  // 1. Recommendation without charging
  it("Scenario 1: recommend suggests a product/package without creating a quote line or charging", () => {
    const flow = createTestFlow({
      rules: [
        {
          id: "r_rec",
          name: "Recommend Lighting for Premium",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "premium" }],
          actions: [{ id: "a1", type: "recommend", targetId: "p_lighting", targetKind: "product" }],
        },
      ],
    });

    const result = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "premium" },
    });

    // p_lighting ($650) is recommended
    expect(result.recommendedProducts.map((p) => p.id)).toContain("p_lighting");
    // But it must NOT be in the quote lines
    const lineTargetIds = result.lines.map((l) => l.targetId).filter(Boolean);
    expect(lineTargetIds).not.toContain("p_lighting");
    // Subtotal and total remain 0 because recommend does not charge
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  // 2. Explicit product selection
  it("Scenario 2: customer explicit selection creates a charged customer_selection line", () => {
    const flow = createTestFlow();

    const result = runEngine({
      flow,
      products,
      packages,
      answers: {},
      selectedProducts: ["p_sound"],
    });

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line?.targetId).toBe("p_sound");
    expect(line?.source).toBe("customer_selection");
    expect(line?.amount).toBe(900);
    expect(result.subtotal).toBe(900);
    expect(result.total).toBe(900);
  });

  // 3. Recommendation disappearing
  it("Scenario 3: recommendations disappear cleanly when rule conditions no longer match", () => {
    const flow = createTestFlow({
      rules: [
        {
          id: "r_rec",
          name: "Recommend Lighting for Premium",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "premium" }],
          actions: [{ id: "a1", type: "recommend", targetId: "p_lighting", targetKind: "product" }],
        },
      ],
    });

    // Premium answers -> recommended
    const resPremium = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "premium" },
    });
    expect(resPremium.recommendedProducts.map((p) => p.id)).toContain("p_lighting");

    // Standard answers -> disappears completely
    const resStandard = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "standard" },
    });
    expect(resStandard.recommendedProducts).toHaveLength(0);
  });

  // 4. Fee removal and reapplication (Idempotency)
  it("Scenario 4: fees apply idempotently, disappear when unmatching, and reapply cleanly", () => {
    const flow = createTestFlow({
      rules: [
        {
          id: "r_fee",
          name: "Large Group Fee",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "guests", operator: "gt", value: "50" }],
          actions: [{ id: "a1", type: "add_fee", amount: 250, label: "Large Group Surcharge" }],
        },
      ],
    });

    // Run 1: guests = 60 -> exactly 1 fee line of $250
    const res1 = runEngine({ flow, products, packages, answers: { guests: 60 } });
    expect(res1.lines).toHaveLength(1);
    expect(res1.lines[0]?.amount).toBe(250);
    expect(res1.lines[0]?.label).toBe("Large Group Surcharge");
    expect(res1.total).toBe(250);

    // Repeated evaluation with same input -> strictly idempotent, no duplicate fees
    const res1Repeat = runEngine({ flow, products, packages, answers: { guests: 60 } });
    expect(res1Repeat.lines).toHaveLength(1);
    expect(res1Repeat.total).toBe(250);

    // Run 2: guests = 40 -> fee disappears completely
    const res2 = runEngine({ flow, products, packages, answers: { guests: 40 } });
    expect(res2.lines).toHaveLength(0);
    expect(res2.total).toBe(0);

    // Run 3: guests = 80 -> fee reapplies cleanly once
    const res3 = runEngine({ flow, products, packages, answers: { guests: 80 } });
    expect(res3.lines).toHaveLength(1);
    expect(res3.total).toBe(250);
  });

  // 5. ALL vs ANY rule conditions
  it("Scenario 5: evaluates match 'all' and match 'any' accurately with multiple conditions", () => {
    const allRule: Rule = {
      id: "r_all",
      name: "VIP Discount",
      active: true,
      match: "all",
      conditions: [
        { id: "c1", variable: "tier", operator: "equals", value: "premium" },
        { id: "c2", variable: "guests", operator: "gt", value: "100" },
      ],
      actions: [{ id: "a1", type: "apply_discount", amount: 100, label: "VIP $100 Off" }],
    };

    const anyRule: Rule = {
      id: "r_any",
      name: "Standard or Small Group",
      active: true,
      match: "any",
      conditions: [
        { id: "c1", variable: "tier", operator: "equals", value: "standard" },
        { id: "c2", variable: "guests", operator: "lt", value: "20" },
      ],
      actions: [{ id: "a1", type: "add_fee", amount: 50, label: "Handling Fee" }],
    };

    // Test ALL rule
    expect(evaluateRule(allRule, { tier: "premium", guests: 50 })).toBe(false);
    expect(evaluateRule(allRule, { tier: "standard", guests: 150 })).toBe(false);
    expect(evaluateRule(allRule, { tier: "premium", guests: 150 })).toBe(true);

    // Test ANY rule
    expect(evaluateRule(anyRule, { tier: "standard", guests: 200 })).toBe(true);
    expect(evaluateRule(anyRule, { tier: "premium", guests: 10 })).toBe(true);
    expect(evaluateRule(anyRule, { tier: "premium", guests: 50 })).toBe(false);
  });

  // 6. Incomplete rule safety (Fail-closed)
  it("Scenario 6: incomplete conditions fail closed and never trigger unconfigured charges", () => {
    // Incomplete ALL rule (second condition has empty variable or empty value)
    const incompleteAllRule: Rule = {
      id: "r_inc_all",
      name: "Partially Configured All Rule",
      active: true,
      match: "all",
      conditions: [
        { id: "c1", variable: "tier", operator: "equals", value: "premium" },
        { id: "c2", variable: "", operator: "equals", value: "" }, // incomplete
      ],
      actions: [{ id: "a1", type: "add_fee", amount: 500, label: "Accidental Charge" }],
    };

    // Even though c1 matches tier: "premium", c2 is incomplete -> MUST fail closed
    expect(evaluateRule(incompleteAllRule, { tier: "premium" })).toBe(false);

    // Incomplete ANY rule where all conditions are incomplete
    const allIncompleteAnyRule: Rule = {
      id: "r_inc_any",
      name: "Unconfigured Any Rule",
      active: true,
      match: "any",
      conditions: [{ id: "c1", variable: "", operator: "equals", value: "" }],
      actions: [{ id: "a1", type: "add_fee", amount: 500, label: "Accidental Charge" }],
    };
    expect(evaluateRule(allIncompleteAnyRule, { tier: "premium" })).toBe(false);

    // Run in engine -> verify no charges created
    const flow = createTestFlow({ rules: [incompleteAllRule] });
    const res = runEngine({ flow, products, packages, answers: { tier: "premium" } });
    expect(res.lines).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  // 7. Chained calculations (Topological dependency resolution)
  it("Scenario 7: resolves chained calculations in topological order regardless of definition order", () => {
    // Component 2 depends on Component 1's resultVariable, but Component 2 is placed first in array
    const calc2: FlowComponent = {
      id: "c_total_cost",
      type: "calculation",
      label: "Total Service Cost",
      calculation: {
        id: "calc_total",
        name: "Total Service Cost",
        resultVariable: "total_cost",
        terms: [
          { id: "t2_1", kind: "variable", variable: "sub_cost", operator: "+" },
          { id: "t2_2", kind: "number", number: 50, operator: "+" },
        ],
      },
    };

    const calc1: FlowComponent = {
      id: "c_sub_cost",
      type: "calculation",
      label: "Sub Cost",
      calculation: {
        id: "calc_sub",
        name: "Sub Cost",
        resultVariable: "sub_cost",
        terms: [
          { id: "t1_1", kind: "variable", variable: "guests", operator: "+" },
          { id: "t1_2", kind: "number", number: 10, operator: "×" },
        ],
      },
    };

    // Placed out of topological order: [calc2, calc1]
    const compList: FlowComponent[] = [
      { id: "c_guests", type: "number", label: "Guests", variable: "guests" },
      calc2,
      calc1,
    ];

    const result = evaluateCalculations(compList, { guests: 20 });

    expect(result.errors).toHaveLength(0);
    expect(result.values["sub_cost"]).toBe(200); // 20 * 10
    expect(result.values["total_cost"]).toBe(250); // 200 + 50
    const totalCalc = result.calculations.find((c) => c.variable === "total_cost");
    expect(totalCalc?.value).toBe(250);
    expect(totalCalc?.isReady).toBe(true);
  });

  // 8. Circular calculation rejection
  it("Scenario 8: circular calculation dependencies are detected and reported without infinite loops", () => {
    const calcA: FlowComponent = {
      id: "c_a",
      type: "calculation",
      label: "Calc A",
      calculation: {
        id: "calc_a",
        name: "Calc A",
        resultVariable: "var_a",
        terms: [
          { id: "t1", kind: "variable", variable: "var_b", operator: "+" },
          { id: "t2", kind: "number", number: 10, operator: "+" },
        ],
      },
    };

    const calcB: FlowComponent = {
      id: "c_b",
      type: "calculation",
      label: "Calc B",
      calculation: {
        id: "calc_b",
        name: "Calc B",
        resultVariable: "var_b",
        terms: [
          { id: "t3", kind: "variable", variable: "var_a", operator: "+" },
          { id: "t4", kind: "number", number: 5, operator: "+" },
        ],
      },
    };

    const flow = createTestFlow({
      components: [calcA, calcB],
    });

    const res = runEngine({
      flow,
      products,
      packages,
      answers: {},
    });

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.some((e) => e.toLowerCase().includes("circular") || e.toLowerCase().includes("cycle"))).toBe(
      true,
    );
  });

  // 9. Missing calculation inputs
  it("Scenario 9: missing inputs mark calculations isReady=false and prevent premature charges", () => {
    const calcComponent: FlowComponent = {
      id: "c_catering",
      type: "calculation",
      label: "Per-head Catering",
      calculation: {
        id: "calc_catering",
        name: "Per-head Catering",
        resultVariable: "catering_charge",
        includeInQuote: true,
        terms: [
          { id: "t1", kind: "variable", variable: "headcount", operator: "+" },
          { id: "t2", kind: "number", number: 45, operator: "×" },
        ],
      },
    };

    const flow = createTestFlow({
      components: [
        { id: "c_headcount", type: "number", label: "Headcount", variable: "headcount" },
        calcComponent,
      ],
    });

    // Case A: headcount has not been answered yet
    const resMissing = runEngine({
      flow,
      products,
      packages,
      answers: {}, // headcount is undefined
    });

    // Should NOT create a $0 line item on the quote for incomplete input
    expect(resMissing.lines.some((l) => l.label === "Per-head Catering")).toBe(false);

    // Case B: headcount is explicitly answered as 0
    const resZero = runEngine({
      flow,
      products,
      packages,
      answers: { headcount: 0 },
    });
    const cateringCalcZero = resZero.calculations.find((c) => c.variable === "catering_charge");
    expect(cateringCalcZero?.value).toBe(0);

    // Case C: headcount is answered as 50
    const resValid = runEngine({
      flow,
      products,
      packages,
      answers: { headcount: 50 },
    });
    expect(resValid.lines.some((l) => l.label === "Per-head Catering" && l.amount === 2250)).toBe(true);
    expect(resValid.total).toBe(2250);
  });

  // 10. set_value dependencies
  it("Scenario 10: set_value actions cascade to re-evaluate downstream calculations and rules", () => {
    const flow = createTestFlow({
      components: [
        { id: "c_guests", type: "number", label: "Guest Count", variable: "guests" },
        { id: "c_tier", type: "text", label: "Tier", variable: "tier" },
      ],
      rules: [
        // Rule 1: when guests >= 100, set tier to "premium"
        {
          id: "r1",
          name: "Auto-promote large events to premium",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "guests", operator: "gte", value: "100" }],
          actions: [{ id: "a1", type: "set_value", variable: "tier", value: "premium" }],
        },
        // Rule 2: when tier === "premium", add sound package
        {
          id: "r2",
          name: "Add Sound for premium tier",
          active: true,
          match: "all",
          conditions: [{ id: "c2", variable: "tier", operator: "equals", value: "premium" }],
          actions: [{ id: "a2", type: "add_to_quote", targetId: "p_sound", targetKind: "product" }],
        },
      ],
    });

    const result = runEngine({
      flow,
      products,
      packages,
      answers: { guests: 150 }, // tier not provided
    });

    expect(result.converged).toBe(true);
    expect(result.resolvedAnswers["tier"]).toBe("premium");
    expect(result.lines.some((l) => l.targetId === "p_sound")).toBe(true);
    expect(result.total).toBe(900);
  });

  // 11. Non-convergent rules (Oscillation / cycle detection)
  it("Scenario 11: rule oscillations are bounded, flagged, and do not crash or hang", () => {
    const flow = createTestFlow({
      components: [{ id: "c_toggle", type: "text", label: "Toggle", variable: "toggle_var" }],
      rules: [
        {
          id: "r_ping",
          name: "Ping to Pong",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "toggle_var", operator: "equals", value: "ping" }],
          actions: [{ id: "a1", type: "set_value", variable: "toggle_var", value: "pong" }],
        },
        {
          id: "r_pong",
          name: "Pong to Ping",
          active: true,
          match: "all",
          conditions: [{ id: "c2", variable: "toggle_var", operator: "equals", value: "pong" }],
          actions: [{ id: "a2", type: "set_value", variable: "toggle_var", value: "ping" }],
        },
      ],
    });

    const result = runEngine({
      flow,
      products,
      packages,
      answers: { toggle_var: "ping" },
    });

    expect(result.converged).toBe(false);
    expect(result.errors.some((e) => e.includes("did not converge") || e.includes("cycle"))).toBe(true);
  });

  // 12. Product and package availability
  it("Scenario 12: inactive products and archived packages are excluded from recommendations and charges", () => {
    const customProducts: Product[] = [
      ...products,
      {
        id: "p_inactive_dj",
        name: "Vintage DJ Setup",
        sku: "DJ-VNT",
        description: "Old equipment",
        price: 300,
        unit: "flat",
        category: "Audio",
        active: false, // INACTIVE
      },
    ];

    const customPackages: Package[] = [
      ...packages,
      {
        id: "pk_archived_legacy",
        name: "Legacy Package",
        description: "No longer sold",
        price: 1000,
        includes: [],
        addons: [],
        archived: true, // ARCHIVED
      },
    ];

    const flow = createTestFlow({
      rules: [
        {
          id: "r_inactive",
          name: "Try to add inactive",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "premium" }],
          actions: [
            { id: "a1", type: "add_to_quote", targetId: "p_inactive_dj", targetKind: "product" },
            { id: "a2", type: "recommend", targetId: "pk_archived_legacy", targetKind: "package" },
          ],
        },
      ],
    });

    const result = runEngine({
      flow,
      products: customProducts,
      packages: customPackages,
      answers: { tier: "premium" },
      selectedProducts: ["p_inactive_dj"], // Customer manually selects inactive
    });

    // Inactive product must NOT be in lines
    expect(result.lines.some((l) => l.targetId === "p_inactive_dj")).toBe(false);
    // Inactive/archived item must not be recommended
    expect(result.recommendedProducts.some((p) => p.id === "p_inactive_dj")).toBe(false);
  });

  // 13. Show/Hide precedence
  it("Scenario 13: rule hide action consistently takes precedence over show and showWhen", () => {
    const flow = createTestFlow({
      components: [
        {
          id: "c_vip_field",
          type: "text",
          label: "VIP Service Notes",
          variable: "vip_notes",
          showWhen: { id: "sw1", variable: "tier", operator: "equals", value: "premium" },
        },
      ],
      rules: [
        {
          id: "r_hide_vip",
          name: "Hide VIP Notes for small budget",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "budget", operator: "lt", value: "1000" }],
          actions: [{ id: "a1", type: "hide", targetId: "c_vip_field", targetKind: "question" }],
        },
      ],
    });

    // Case A: tier=premium, budget=500 -> showWhen would pass, but rule hides it
    const resHidden = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "premium", budget: 500 },
    });
    expect(resHidden.hiddenComponentIds).toContain("c_vip_field");

    // Case B: tier=premium, budget=2000 -> showWhen passes, rule does not hide
    const resVisible = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "premium", budget: 2000 },
    });
    expect(resVisible.hiddenComponentIds).not.toContain("c_vip_field");

    // Case C: tier=standard -> showWhen fails
    const resShowWhenFailed = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "standard", budget: 2000 },
    });
    expect(resShowWhenFailed.hiddenComponentIds).toContain("c_vip_field");
  });

  // 14. Duplicate-charge prevention
  it("Scenario 14: avoids duplicate line items when a product is both rule-added and customer-selected", () => {
    const flow = createTestFlow({
      rules: [
        {
          id: "r_add_sound",
          name: "Add Sound for Premium",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "premium" }],
          actions: [{ id: "a1", type: "add_to_quote", targetId: "p_sound", targetKind: "product" }],
        },
      ],
    });

    const result = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "premium" },
      selectedProducts: ["p_sound"], // Customer also explicitly selected it
    });

    // Should contain sound package exactly once
    const soundLines = result.lines.filter((l) => l.targetId === "p_sound");
    expect(soundLines).toHaveLength(1);
    expect(result.subtotal).toBe(900); // Sound price is $900, NOT $1800
    expect(result.total).toBe(900);
  });

  // 15. Calculation-based pricing
  it("Scenario 15: includeInQuote=true creates a valid calculation line item with correct amount", () => {
    const flow = createTestFlow({
      components: [
        { id: "c_hours", type: "number", label: "Labor Hours", variable: "labor_hours" },
        {
          id: "c_calc_labor",
          type: "calculation",
          label: "On-site Labor Cost",
          calculation: {
            id: "calc_labor",
            name: "On-site Engineering Labor",
            resultVariable: "labor_cost",
            includeInQuote: true,
            terms: [
              { id: "t1", kind: "variable", variable: "labor_hours", operator: "+" },
              { id: "t2", kind: "number", number: 85, operator: "×" },
            ],
          },
        },
      ],
    });

    const result = runEngine({
      flow,
      products,
      packages,
      answers: { labor_hours: 10 },
    });

    const laborLine = result.lines.find((l) => l.label === "On-site Engineering Labor");
    expect(laborLine).toBeDefined();
    expect(laborLine?.source).toBe("calculation");
    expect(laborLine?.amount).toBe(850);
    expect(result.total).toBe(850);
  });

  // 16. No double charging for package-included items
  it("Scenario 16: informational calculations without includeInQuote do not create duplicate line charges", () => {
    const ws = seedData();
    const rentalFlow = ws.flows.find((f) => f.id === "fl_event_rental")!;

    const result = runEngine({
      flow: rentalFlow,
      products: ws.products,
      packages: ws.packages,
      answers: { guest_count: 100, chairs_required: 150 },
    });

    // Base package ($2,500) is charged
    const pkgLine = result.lines.find((l) => l.targetId === "pk_event_rental");
    expect(pkgLine).toBeDefined();
    expect(pkgLine?.amount).toBe(2500);

    // Seating calculation in fl_event_rental is derived and available in calculations:
    const seatingCalc = result.calculations.find((c) => c.variable === "seating_total");
    expect(seatingCalc).toBeDefined();
    expect(seatingCalc?.value).toBe(1350); // 150 * 9

    // But NOT charged again as a separate calculation quote line!
    const seatingLine = result.lines.find((l) => l.label === "Seating Total");
    expect(seatingLine).toBeUndefined();

    // Total should equal package price $2,500
    expect(result.total).toBe(2500);
  });

  // 17. Discount and rounding correctness
  it("Scenario 17: monetary rounding is accurate to 2 decimals, clamps total >= 0, and handles NaN/div-zero", () => {
    const flow = createTestFlow({
      basePackageId: "pk_event_rental", // $2500
      rules: [
        {
          id: "r_disc",
          name: "Promo Discount",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "standard" }],
          actions: [{ id: "a1", type: "apply_discount", amount: 250, label: "Promo" }],
        },
      ],
    });

    const resDiscount = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "standard" },
    });

    expect(resDiscount.subtotal).toBe(2500);
    expect(resDiscount.discount).toBe(250);
    expect(resDiscount.total).toBe(2250);

    // Test extreme discount clamping >= 0
    const flowExtreme = createTestFlow({
      basePackageId: "pk_event_rental", // $2500
      rules: [
        {
          id: "r_huge_discount",
          name: "Over-discount",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "standard" }],
          actions: [{ id: "a1", type: "apply_discount", amount: 5000, label: "Huge Credit" }],
        },
      ],
    });

    const resExtreme = runEngine({
      flow: flowExtreme,
      products,
      packages,
      answers: { tier: "standard" },
    });

    // Discount clamped to subtotal $2500, total is $0 (never negative)
    expect(resExtreme.discount).toBe(2500);
    expect(resExtreme.total).toBe(0);

    // Test divide-by-zero protection in runCalculation
    const divZeroCalc = {
      id: "calc_div",
      name: "Divide by Zero",
      resultVariable: "zero_res",
      terms: [
        { id: "t1", kind: "number" as const, number: 100, operator: "+" as const },
        { id: "t2", kind: "number" as const, number: 0, operator: "÷" as const },
      ],
    };
    const divResult = runCalculation(divZeroCalc, {});
    expect(Number.isFinite(divResult)).toBe(true);
    expect(divResult).toBe(0);
  });

  // 18. Existing data migration compatibility
  it("Scenario 18: seedData flows, packages, and enquiries evaluate safely without regressions", () => {
    const ws = seedData();
    for (const flow of ws.flows) {
      const res = runEngine({
        flow,
        products: ws.products,
        packages: ws.packages,
        answers: {},
      });
      expect(Number.isFinite(res.total)).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.lines)).toBe(true);
    }

    // Evaluate quotes on all initial seed enquiries
    for (const enquiry of ws.enquiries) {
      const enqQuote = evaluateEnquiryQuote(enquiry, ws);
      expect(enqQuote).not.toBeNull();
      expect(enqQuote!.total).toBeGreaterThanOrEqual(0);
      expect(enqQuote!.lines.length).toBeGreaterThan(0);
    }
  });

  // 19. Sprint 1 variable-reference safety
  it("Scenario 19: renaming variables and calculation results updates rules and components safely", () => {
    const flow = createTestFlow({
      components: [
        { id: "c_guests", type: "number", label: "Guest Count", variable: "guests" },
        {
          id: "c_tier",
          type: "radio",
          label: "Service Tier",
          variable: "tier",
          options: [
            { id: "opt_standard", label: "Standard", value: "standard" },
            { id: "opt_premium", label: "Premium", value: "premium" },
          ],
        },
        {
          id: "c_calc",
          type: "calculation",
          label: "Fee Calc",
          calculation: {
            id: "calc_fee",
            name: "Fee Calc",
            resultVariable: "calculated_fee",
            terms: [{ id: "t1", kind: "variable", variable: "guests", operator: "+" }],
          },
        },
      ],
      rules: [
        {
          id: "r1",
          name: "Rule on guests",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "guests", operator: "gt", value: "50" }],
          actions: [{ id: "a1", type: "add_fee", amount: 100, label: "Fee" }],
        },
        {
          id: "r2",
          name: "Rule on calculation result",
          active: true,
          match: "all",
          conditions: [{ id: "c2", variable: "calculated_fee", operator: "gt", value: "100" }],
          actions: [{ id: "a2", type: "add_fee", amount: 50, label: "High Fee" }],
        },
      ],
    });

    // 1. Rename flow variable "guests" -> "attendees"
    const renameVarRes = renameFlowVariable(flow, "guests", "attendees", "c_guests");
    expect(renameVarRes.success).toBe(true);
    const updatedFlow = renameVarRes.flow;
    expect(updatedFlow.components.find((c) => c.id === "c_guests")?.variable).toBe("attendees");
    expect(updatedFlow.rules[0]?.conditions[0]?.variable).toBe("attendees");
    const updatedCalc = updatedFlow.components.find((c) => c.id === "c_calc")?.calculation;
    expect(updatedCalc?.terms[0]?.variable).toBe("attendees");

    // 2. Rename calculation result variable "calculated_fee" -> "computed_service_fee"
    const renameCalcRes = renameCalculationResultVariable(updatedFlow, "c_calc", "computed_service_fee");
    expect(renameCalcRes.success).toBe(true);
    const flowAfterCalcRename = renameCalcRes.flow;
    expect(
      flowAfterCalcRename.components.find((c) => c.id === "c_calc")?.calculation?.resultVariable,
    ).toBe("computed_service_fee");
    expect(flowAfterCalcRename.rules[1]?.conditions[0]?.variable).toBe("computed_service_fee");

    // 3. Rename option value in radio component
    const flowAfterOptRename = renameFlowOptionValue(flowAfterCalcRename, "c_tier", "opt_premium", "ultra_vip");
    const radioComp = flowAfterOptRename.components.find((c) => c.id === "c_tier");
    expect(radioComp?.options?.find((o) => o.id === "opt_premium")?.value).toBe("ultra_vip");
  });

  // 20. Existing route and component compatibility (Snapshots & Proposal generation)
  it("Scenario 20: snapshots preserve independent immutable copies matching engine evaluations", () => {
    const ws = seedData();
    const flow = createTestFlow({
      basePackageId: "pk_wedding_premium", // $2500
      rules: [
        {
          id: "r_sound",
          name: "Add Sound for Standard",
          active: true,
          match: "all",
          conditions: [{ id: "c1", variable: "tier", operator: "equals", value: "standard" }],
          actions: [{ id: "a1", type: "add_to_quote", targetId: "p_sound", targetKind: "product" }],
        },
      ],
    });

    const engineResult = runEngine({
      flow,
      products,
      packages,
      answers: { tier: "standard" },
    });

    // Snapshot created from engine result
    const quoteSnapshot = createQuoteSnapshot(flow, engineResult);
    expect(quoteSnapshot.subtotal).toBe(engineResult.subtotal);
    expect(quoteSnapshot.total).toBe(engineResult.total);
    expect(quoteSnapshot.lines).toHaveLength(engineResult.lines.length);

    // Mutating engineResult lines does not mutate quoteSnapshot
    engineResult.lines.pop();
    expect(quoteSnapshot.lines.length).toBe(engineResult.lines.length + 1);

    // Proposal snapshot created
    const enquiry = ws.enquiries[0]!;
    const proposalSnapshot = createProposalSnapshot({
      flow,
      enquiry,
      result: engineResult,
      ws,
    });

    expect(proposalSnapshot.quote.total).toBe(engineResult.total);
    expect(proposalSnapshot.quote.subtotal).toBe(engineResult.subtotal);
  });
});
