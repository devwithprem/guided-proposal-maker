import { beforeEach, describe, expect, it } from "vitest";
import {
  findFieldDependencies,
  getCustomerQuestionComponents,
  mergeFormBuilderDataIntoFlow,
  normalizeContainersAndOrphans,
  toFormBuilderSchema,
  validateFlowFieldDeletions,
} from "../form-builder-adapter";
import type { Flow, FlowComponent, LayoutContainer, FormDesign, Rule } from "../types";
import type { FormFieldData } from "@devcode-tech/form-builder";
import { seedData } from "../seed";

function createMockFlow(overrides?: Partial<Flow>): Flow {
  const base = seedData().flows[0]!;
  return {
    ...base,
    ...overrides,
  };
}

describe("QuoteFlow — Form Builder Integration Parity & Full-Screen Architecture", () => {
  describe("1. Tragami Container & Orphan Normalization Parity", () => {
    it("assigns unassigned fields to deterministic fallback container", () => {
      const fields: FormFieldData[] = [
        { id: "q1", type: "text", label: "Question 1" },
        { id: "q2", type: "number", label: "Question 2" },
        { id: "q3", type: "select", label: "Question 3" },
      ];

      // Only q1 is in container_1
      const existingContainers: LayoutContainer[] = [
        { id: "container_1", type: "grid", columns: 2, children: ["q1"] },
      ];

      const normalized = normalizeContainersAndOrphans(fields, existingContainers);

      expect(normalized.length).toBe(2);
      expect(normalized[0]!.id).toBe("container_1");
      expect(normalized[0]!.children).toEqual(["q1"]);
      expect(normalized[0]!.columns).toBe(2);

      // q2 and q3 should be in fallback container
      expect(normalized[1]!.id).toBe("container_fallback_orphaned");
      expect(normalized[1]!.children).toEqual(["q2", "q3"]);
      expect(normalized[1]!.columns).toBe(1);
    });

    it("prunes deleted fields and deduplicates children across containers", () => {
      const fields: FormFieldData[] = [
        { id: "q1", type: "text", label: "Question 1" },
        { id: "q2", type: "number", label: "Question 2" },
      ];

      // Container references q1 twice and includes deleted q_ghost
      const existingContainers: LayoutContainer[] = [
        { id: "c1", children: ["q1", "q_ghost", "q1"] },
        { id: "c2", children: ["q1", "q2"] }, // q1 already claimed in c1
      ];

      const normalized = normalizeContainersAndOrphans(fields, existingContainers);

      expect(normalized[0]!.children).toEqual(["q1"]);
      expect(normalized[1]!.children).toEqual(["q2"]);
    });

    it("creates fallback container when existing containers is empty", () => {
      const fields: FormFieldData[] = [
        { id: "q1", type: "text", label: "Question 1" },
        { id: "q2", type: "number", label: "Question 2" },
      ];

      const normalized = normalizeContainersAndOrphans(fields, []);
      expect(normalized.length).toBe(1);
      expect(normalized[0]!.id).toBe("container_fallback_orphaned");
      expect(normalized[0]!.children).toEqual(["q1", "q2"]);
    });
  });

  describe("2. Schema Bidirectional Preservation & Layout Persistence", () => {
    it("preserves custom layout containers and theme design in toFormBuilderSchema", () => {
      const customContainers: LayoutContainer[] = [
        { id: "c_grid", type: "grid", columns: 2, children: ["c_guests"] },
      ];
      const customDesign: FormDesign = {
        brandColor: "#6366f1",
        backgroundColor: "#f8fafc",
        fontFamily: "font-serif",
      };

      const flow = createMockFlow({
        containers: customContainers,
        design: customDesign,
      });

      const schema = toFormBuilderSchema(flow);

      expect(schema.containers[0]?.id).toBe("c_grid");
      expect(schema.design.brandColor).toBe("#6366f1");
      expect(schema.design.fontFamily).toBe("font-serif");
    });

    it("saves updated containers and design onto flow in mergeFormBuilderDataIntoFlow", () => {
      const flow = createMockFlow();
      const updatedContainers: LayoutContainer[] = [
        { id: "c_two_col", type: "grid", columns: 2, children: [flow.components[0]!.id] },
      ];
      const updatedDesign: FormDesign = {
        brandColor: "#059669",
        backgroundColor: "#111827",
      };

      const schema = toFormBuilderSchema(flow);
      const merged = mergeFormBuilderDataIntoFlow(flow, {
        fields: schema.fields,
        containers: updatedContainers,
        design: updatedDesign,
      });

      expect(merged.containers).toBeDefined();
      expect(merged.containers![0]!.id).toBe("c_two_col");
      expect(merged.design).toBeDefined();
      expect(merged.design!.brandColor).toBe("#059669");
    });
  });

  describe("3. Field Deletion Parity & Non-Input Component Protection", () => {
    it("deletes removed question fields while strictly preserving calculations and variables", () => {
      const flow = createMockFlow();
      const originalCalcCount = flow.components.filter((c) => c.type === "calculation").length;
      expect(originalCalcCount).toBeGreaterThan(0);

      const questions = getCustomerQuestionComponents(flow);
      expect(questions.length).toBeGreaterThan(1);

      // Simulate FormBuilder returning all questions EXCEPT the first one (user deleted it)
      const fieldToDelete = questions[0]!;
      const remainingQuestions = questions.slice(1);
      const incomingFields = remainingQuestions.map((q) => ({
        id: q.id,
        type: q.type,
        label: q.label,
        name: q.variable,
      }));

      const merged = mergeFormBuilderDataIntoFlow(flow, {
        fields: incomingFields,
      });

      // The deleted question should NOT be in merged components
      expect(merged.components.some((c) => c.id === fieldToDelete.id)).toBe(false);

      // Remaining questions should still be present
      for (const q of remainingQuestions) {
        expect(merged.components.some((c) => c.id === q.id)).toBe(true);
      }

      // Calculations, variables, and price-summary nodes MUST be completely preserved
      const preservedCalcs = merged.components.filter((c) => c.type === "calculation");
      expect(preservedCalcs.length).toBe(originalCalcCount);
      expect(merged.components.some((c) => c.type === "price-summary")).toBe(true);
    });

    it("appends new fields created in Form Builder with unique variables", () => {
      const flow = createMockFlow();
      const schema = toFormBuilderSchema(flow);

      const newField: FormFieldData = {
        id: "field_dietary_needs",
        type: "text",
        label: "Dietary Preferences",
        mapping: "dietary_preferences",
        required: false,
      };

      const merged = mergeFormBuilderDataIntoFlow(flow, {
        fields: [...schema.fields, newField],
      });

      const added = merged.components.find((c) => c.id === "field_dietary_needs");
      expect(added).toBeDefined();
      expect(added!.label).toBe("Dietary Preferences");
      expect(added!.type).toBe("text");
      expect(added!.variable).toBeDefined();
    });

    it("reorders question components according to multi-container layout hierarchy", () => {
      const flow = createMockFlow();
      const questions = getCustomerQuestionComponents(flow);
      if (questions.length >= 2) {
        const [q1, q2] = questions;
        const schema = toFormBuilderSchema(flow);

        // Put q2 in container 1 and q1 in container 2
        const containers: LayoutContainer[] = [
          { id: "ctr_top", children: [q2!.id] },
          { id: "ctr_bottom", children: [q1!.id] },
        ];

        const merged = mergeFormBuilderDataIntoFlow(flow, {
          fields: schema.fields,
          containers,
        });

        const mergedQuestions = getCustomerQuestionComponents(merged);
        const idx1 = mergedQuestions.findIndex((c) => c.id === q1!.id);
        const idx2 = mergedQuestions.findIndex((c) => c.id === q2!.id);

        expect(idx2).toBeLessThan(idx1);
      }
    });
  });

  describe("4. Rule and Calculation Dependency Detection", () => {
    it("findFieldDependencies identifies rule conditions referencing a field", () => {
      const flow = createMockFlow({
        rules: [
          {
            id: "rule_guest_high",
            name: "High Guest Surcharge",
            match: "all",
            active: true,
            conditions: [
              { id: "cond_1", variable: "guest_count", operator: "gt", value: "100" },
            ],
            actions: [
              { id: "act_1", type: "add_fee", amount: 200, label: "Large party surcharge" },
            ],
          },
        ],
      });

      const guestComp = flow.components.find((c) => c.variable === "guest_count");
      expect(guestComp).toBeDefined();

      const deps = findFieldDependencies(flow, guestComp!.id);
      expect(deps.some((d) => d.type === "rule_condition" && d.id === "rule_guest_high")).toBe(true);
    });

    it("findFieldDependencies identifies rule actions targeting a field", () => {
      const flow = createMockFlow({
        rules: [
          {
            id: "rule_hide_tent",
            name: "Hide Tent",
            match: "all",
            active: true,
            conditions: [],
            actions: [
              { id: "act_1", type: "hide", targetKind: "question", targetId: "c_tent" },
            ],
          },
        ],
      });

      const deps = findFieldDependencies(flow, "c_tent");
      expect(deps.some((d) => d.type === "rule_action" && d.id === "rule_hide_tent")).toBe(true);
    });

    it("findFieldDependencies identifies calculations referencing a variable", () => {
      const flow = createMockFlow({
        components: [
          {
            id: "comp_area",
            type: "number",
            label: "Square Meters",
            variable: "area_sqm",
          },
          {
            id: "calc_price",
            type: "calculation",
            label: "Total Area Price",
            calculation: {
              id: "c_formula",
              name: "Area Calculation",
              resultVariable: "calc_total_area",
              terms: [
                { id: "t1", kind: "variable", variable: "area_sqm" },
                { id: "t2", kind: "number", variable: undefined },
              ],
            },
          },
        ],
      });

      const deps = findFieldDependencies(flow, "comp_area");
      expect(deps.some((d) => d.type === "calculation" && d.name === "Area Calculation")).toBe(true);
    });

    it("validateFlowFieldDeletions flags conflicts when dependent fields are deleted", () => {
      const flow = createMockFlow({
        rules: [
          {
            id: "rule_critical",
            name: "Important Rule",
            match: "all",
            active: true,
            conditions: [{ id: "c1", variable: "guest_count", operator: "gt", value: "50" }],
            actions: [],
          },
        ],
        components: [
          {
            id: "field_guests",
            type: "number",
            label: "Number of Guests",
            variable: "guest_count",
          },
          {
            id: "field_notes",
            type: "text",
            label: "Additional Notes",
            variable: "notes",
          },
        ],
      });

      // Incoming fields only has field_notes (field_guests omitted)
      const incomingIds = new Set(["field_notes"]);
      const check = validateFlowFieldDeletions(flow, incomingIds);

      expect(check.canDelete).toBe(false);
      expect(check.conflicts.length).toBe(1);
      expect(check.conflicts[0]!.fieldId).toBe("field_guests");
      expect(check.conflicts[0]!.dependencies[0]!.type).toBe("rule_condition");
    });

    it("validateFlowFieldDeletions allows deletion when independent fields are removed", () => {
      const flow = createMockFlow({
        rules: [],
        components: [
          {
            id: "field_notes",
            type: "text",
            label: "Additional Notes",
            variable: "notes",
          },
        ],
      });

      // User removes field_notes (incomingIds is empty)
      const incomingIds = new Set<string>();
      const check = validateFlowFieldDeletions(flow, incomingIds);

      expect(check.canDelete).toBe(true);
      expect(check.conflicts.length).toBe(0);
    });
  });
});
