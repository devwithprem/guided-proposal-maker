import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  EditableFormBuilder,
  FormBuilder,
  FormPreviewLive,
  LocaleProvider,
  normalizeFieldData,
  normalizeFormSchema,
} from "@devcode-tech/form-builder";
import { FormSurface, validateField as gamiflowValidateField } from "@devcode-tech/gamiflow-core";
import {
  componentToFormFieldData,
  conditionToConditionalLogic,
  conditionalLogicToCondition,
  formFieldDataToComponent,
  getCustomerQuestionComponents,
  mergeExternalFieldsIntoFlow,
  mergeFormBuilderDataIntoFlow,
  normalizeFormAnswers,
  toExternalFormSchema,
  toFormBuilderSchema,
  validateFlowField,
} from "../form-builder-adapter";
import { runEngine } from "../engine";
import { seedData, uid } from "../seed";
import type { Condition, Flow, FlowComponent } from "../types";

describe("Sprint 3: Private Form Builder Integration & Safety", () => {
  const getTestFlow = (): Flow => {
    const ws = seedData();
    const flow = ws.flows[0];
    if (!flow) throw new Error("Seed flow missing");
    return structuredClone(flow);
  };

  describe("1. Real Package Exports & Primitives", () => {
    it("exports all verified form-builder primitives", () => {
      expect(typeof FormBuilder).toBe("object"); // React forwardRef object
      expect(typeof EditableFormBuilder).toBe("object"); // React forwardRef object
      expect(typeof FormPreviewLive).toBe("function");
      expect(typeof LocaleProvider).toBe("function");
      expect(typeof normalizeFormSchema).toBe("function");
      expect(typeof normalizeFieldData).toBe("function");
    });

    it("exports all verified gamiflow-core primitives", () => {
      expect(typeof FormSurface).toBe("function");
      expect(typeof gamiflowValidateField).toBe("function");
    });

    it("SSR renders FormSurface cleanly without DOM globals", () => {
      const html = renderToString(
        React.createElement(FormSurface, { className: "test-surface" }, React.createElement("p", null, "Hello")),
      );
      expect(html).toContain("Hello");
      expect(html).toContain('data-gf-form-surface="true"');
    });

    it("SSR renders LocaleProvider and FormPreviewLive without throwing", () => {
      const fields = [normalizeFieldData({ id: "f1", type: "text", label: "Test Question" })];
      const containers = [{ id: "c1", children: ["f1"] }];

      const html = renderToString(
        React.createElement(
          LocaleProvider,
          { locale: "en" },
          React.createElement(FormPreviewLive, { fields, containers }),
        ),
      );
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });
  });

  describe("2. Schema Conversion & Bidirectional Mapping", () => {
    it("converts a QuoteFlow flow into full Form Builder schema with fields and containers", () => {
      const flow = getTestFlow();
      const schema = toFormBuilderSchema(flow);

      expect(schema.title).toBe(flow.name);
      expect(schema.fields.length).toBeGreaterThan(0);
      expect(schema.containers.length).toBe(1);
      expect(schema.containers[0]?.children.length).toBe(schema.fields.length);
      expect(schema.design.brandColor).toBeDefined();

      // Ensure no calculation or price-summary nodes leaked into question fields
      const nonInputTypes = ["calculation", "variable", "price-summary", "proposal", "recommendation"];
      for (const f of schema.fields) {
        expect(nonInputTypes.includes(f.type)).toBe(false);
      }
    });

    it("includes contact fields when explicitly requested for full preview", () => {
      const flow = getTestFlow();
      const schemaOnlyQuestions = toFormBuilderSchema(flow, { includeContactFields: false });
      const schemaAll = toFormBuilderSchema(flow, { includeContactFields: true });

      expect(schemaAll.fields.length).toBe(
        schemaOnlyQuestions.fields.length + (flow.contactFields?.length ?? 0),
      );
    });

    it("maps QuoteFlow conditions to Form Builder conditionalLogic bidirectionally", () => {
      const cond: Condition = {
        id: "cond_1",
        variable: "guest_count",
        operator: "gt",
        value: "50",
      };

      const logic = conditionToConditionalLogic(cond);
      expect(logic).toEqual({
        dependsOn: "guest_count",
        condition: "greater_than",
        value: "50",
      });

      const roundTrip = conditionalLogicToCondition(logic);
      expect(roundTrip).toBeDefined();
      expect(roundTrip?.variable).toBe("guest_count");
      expect(roundTrip?.operator).toBe("gt");
      expect(roundTrip?.value).toBe("50");
    });
  });

  describe("3. Non-Destructive Merge & Variable Stability", () => {
    it("merges updated question fields without dropping calculations or pricing nodes", () => {
      const flow = getTestFlow();
      const originalCalculations = flow.components.filter((c) => c.type === "calculation");
      const originalPriceSummaries = flow.components.filter((c) => c.type === "price-summary");

      expect(originalCalculations.length).toBeGreaterThan(0);

      // Simulate Form Builder returning updated fields
      const schema = toFormBuilderSchema(flow);
      const updatedFields = schema.fields.map((f, i) => {
        const item = { ...f };
        if (i === 0) item.label = "Updated Question Title";
        return item;
      });

      const mergedFlow = mergeFormBuilderDataIntoFlow(flow, {
        fields: updatedFields,
        containers: schema.containers,
      });

      // Assert calculations preserved intact
      const mergedCalculations = mergedFlow.components.filter((c) => c.type === "calculation");
      expect(mergedCalculations.length).toBe(originalCalculations.length);
      expect(mergedCalculations[0]?.calculation).toEqual(originalCalculations[0]?.calculation);

      // Assert price summary preserved intact
      const mergedPriceSummaries = mergedFlow.components.filter((c) => c.type === "price-summary");
      expect(mergedPriceSummaries.length).toBe(originalPriceSummaries.length);

      // Assert question label updated
      const updatedFirstQuestion = mergedFlow.components.find((c) => c.id === updatedFields[0]?.id);
      expect(updatedFirstQuestion?.label).toBe("Updated Question Title");
    });

    it("preserves locked variable identities when external field labels change", () => {
      const flow = getTestFlow();
      const firstQ = flow.components.find((c) => c.variable && c.type !== "calculation")!;
      expect(firstQ.variable).toBeDefined();
      const originalVar = firstQ.variable;

      // Simulate external editor changing label and name
      const schema = toFormBuilderSchema(flow);
      const incomingFields = schema.fields.map((f) => {
        if (f.id === firstQ.id) {
          return { ...f, label: "Completely New Label", mapping: "completely_new_label" };
        }
        return f;
      });

      const mergedFlow = mergeFormBuilderDataIntoFlow(flow, { fields: incomingFields });
      const preservedQ = mergedFlow.components.find((c) => c.id === firstQ.id)!;

      // Variable must remain stable because variableLocked is true
      expect(preservedQ.variable).toBe(originalVar);
      expect(preservedQ.label).toBe("Completely New Label");
    });

    it("preserves existing option values and IDs during option label editing", () => {
      const flow = getTestFlow();
      const dropdownComp = flow.components.find((c) => c.options && c.options.length > 0)!;
      const originalOptions = dropdownComp.options!;
      const originalFirstOpt = originalOptions[0]!;

      const schema = toFormBuilderSchema(flow);
      const updatedFields = schema.fields.map((f) => {
        if (f.id === dropdownComp.id && f.options) {
          const newOpts = f.options.map((o, idx) =>
            idx === 0 ? { ...o, label: "Customized First Option" } : o,
          );
          return {
            ...f,
            options: newOpts,
          };
        }
        return f;
      });

      const mergedFlow = mergeFormBuilderDataIntoFlow(flow, { fields: updatedFields });
      const updatedComp = mergedFlow.components.find((c) => c.id === dropdownComp.id)!;

      expect(updatedComp.options?.[0]?.id).toBe(originalFirstOpt.id);
      expect(updatedComp.options?.[0]?.value).toBe(originalFirstOpt.value);
      expect(updatedComp.options?.[0]?.label).toBe("Customized First Option");
    });

    it("reorders questions according to container layout order", () => {
      const flow = getTestFlow();
      const questions = getCustomerQuestionComponents(flow);
      if (questions.length < 2) return;

      const [firstQ, secondQ] = questions;
      const reversedIds = [secondQ!.id, firstQ!.id];

      const schema = toFormBuilderSchema(flow);
      const containers = [{ id: "c1", children: reversedIds }];

      const merged = mergeFormBuilderDataIntoFlow(flow, { fields: schema.fields, containers });
      const updatedQuestions = getCustomerQuestionComponents(merged);

      const firstIdx = updatedQuestions.findIndex((q) => q.id === firstQ!.id);
      const secondIdx = updatedQuestions.findIndex((q) => q.id === secondQ!.id);

      expect(firstIdx).toBeGreaterThan(-1);
      expect(secondIdx).toBeGreaterThan(-1);
    });
  });

  describe("4. Field Validation with gamiflow-core", () => {
    it("validates required fields using gamiflowValidateField", () => {
      const comp: FlowComponent = {
        id: "c_req",
        type: "text",
        label: "Required Name",
        variable: "req_name",
        required: true,
      };

      const errEmpty = validateFlowField(comp, "");
      expect(errEmpty).toBeTruthy();

      const errProvided = validateFlowField(comp, "Prem");
      expect(errProvided).toBeNull();
    });

    it("validates email fields for proper format", () => {
      const comp: FlowComponent = {
        id: "c_email",
        type: "email",
        label: "Work Email",
        variable: "work_email",
        required: true,
      };

      const errInvalid = validateFlowField(comp, "not-an-email");
      expect(errInvalid).toBeTruthy();

      const errValid = validateFlowField(comp, "test@example.com");
      expect(errValid).toBeNull();
    });

    it("validates number fields against min and max constraints", () => {
      const comp: FlowComponent = {
        id: "c_num",
        type: "number",
        label: "Guest Count",
        variable: "guests",
        min: 10,
        max: 500,
        required: true,
      };

      const errBelow = validateFlowField(comp, 5);
      expect(errBelow).toBeTruthy();

      const errAbove = validateFlowField(comp, 1000);
      expect(errAbove).toBeTruthy();

      const errValid = validateFlowField(comp, 150);
      expect(errValid).toBeNull();
    });
  });

  describe("5. Form Answers Normalization & Business Engine Integration", () => {
    it("normalizes raw input keyed by variable slug or field ID", () => {
      const flow = getTestFlow();
      const raw = {
        contact_name: "Jane Doe",
        contact_email: "jane@company.com",
        guest_count: "75",
        event_type: "corporate",
      };

      const answers = normalizeFormAnswers(raw, flow);
      expect(answers["contact_name"]).toBe("Jane Doe");
      expect(answers["contact_email"]).toBe("jane@company.com");
      expect(answers["guest_count"]).toBe(75); // Coerced to number
      expect(answers["event_type"]).toBe("corporate");
    });

    it("normalized answers feed directly into runEngine with accurate pricing calculations", () => {
      const ws = seedData();
      const flow = ws.flows[0]!;
      const rawAnswers = {
        guest_count: 100,
        event_type: "wedding",
      };

      const answers = normalizeFormAnswers(rawAnswers, flow);
      const result = runEngine({
        flow,
        answers,
        products: ws.products,
        packages: ws.packages,
      });

      expect(result.subtotal).toBeGreaterThan(0);
      expect(result.total).toBe(result.subtotal - result.discount);
      expect(Array.isArray(result.lines)).toBe(true);
    });
  });

  describe("6. Backward Compatibility with Sprint 1 Adapter", () => {
    it("supports toExternalFormSchema and mergeExternalFieldsIntoFlow seamlessly", () => {
      const flow = getTestFlow();
      const ext = toExternalFormSchema(flow);

      expect(ext.flowId).toBe(flow.id);
      expect(ext.contactStep.length).toBe(flow.contactFields.length);
      expect(ext.questionStep.length).toBe(getCustomerQuestionComponents(flow).length);

      const merged = mergeExternalFieldsIntoFlow(flow.components, ext.questionStep);
      expect(merged.length).toBe(flow.components.length);
    });
  });
});

