import type { Answers } from "./engine";
import type { Flow, FlowComponent } from "./types";

/**
 * Integration boundary between QuoteFlow's domain model (`Flow`, `FlowComponent`, `Answers`)
 * and external form builders like `@devcode-tech/form-builder` / `@devcode-tech/gamiflow-core`.
 *
 * All QuoteFlow business logic (rules, calculations, product/package recommendations, snapshots)
 * remains decoupled from the external form builder's internal schema representation.
 */

export interface ExternalFormFieldSchema {
  id: string;
  key: string;
  type: string;
  label: string;
  description?: string | undefined;
  required?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
  options?: { id: string; label: string; value: string }[] | undefined;
}

export interface ExternalFormSchema {
  flowId: string;
  contactStep: ExternalFormFieldSchema[];
  questionStep: ExternalFormFieldSchema[];
}

const NON_INPUT_COMPONENT_TYPES = new Set([
  "variable",
  "calculation",
  "price-summary",
  "proposal",
  "crm-action",
  "recommendation",
]);

/**
 * Filters a Flow's components down to customer-visible question components,
 * ensuring internal `variable` and `calculation` nodes never render as customer inputs.
 */
export function getCustomerQuestionComponents(
  flow: Flow,
  hiddenIds: ReadonlySet<string> = new Set(),
): FlowComponent[] {
  return flow.components.filter(
    (c) => Boolean(c.variable) && !NON_INPUT_COMPONENT_TYPES.has(c.type) && !hiddenIds.has(c.id),
  );
}

/**
 * Converts a QuoteFlow `Flow` into a normalized schema ready for external form-builder consumption.
 * Preserves all component IDs, variable bindings, and option values.
 */
export function toExternalFormSchema(flow: Flow): ExternalFormSchema {
  const mapField = (c: FlowComponent): ExternalFormFieldSchema => {
    const schema: ExternalFormFieldSchema = {
      id: c.id,
      key: c.variable ?? c.id,
      type: c.type,
      label: c.label,
    };
    if (c.description !== undefined) schema.description = c.description;
    if (c.required !== undefined) schema.required = c.required;
    if (c.min !== undefined) schema.min = c.min;
    if (c.max !== undefined) schema.max = c.max;
    if (c.unit !== undefined) schema.unit = c.unit;
    if (c.options !== undefined) schema.options = c.options.map((o) => ({ ...o }));
    return schema;
  };

  return {
    flowId: flow.id,
    contactStep: (flow.contactFields ?? []).map(mapField),
    questionStep: getCustomerQuestionComponents(flow).map(mapField),
  };
}

/**
 * Merges updated field definitions from an external form builder back into QuoteFlow's `FlowComponent[]`
 * without losing QuoteFlow-specific metadata (`calculation`, `showWhen`, `variableLocked`, business/output nodes).
 */
export function mergeExternalFieldsIntoFlow(
  existingComponents: FlowComponent[],
  updatedFields: ExternalFormFieldSchema[],
): FlowComponent[] {
  const existingById = new Map(existingComponents.map((c) => [c.id, c]));
  const updatedById = new Map(updatedFields.map((f) => [f.id, f]));

  const result: FlowComponent[] = [];

  for (const comp of existingComponents) {
    if (NON_INPUT_COMPONENT_TYPES.has(comp.type)) {
      result.push(comp);
      continue;
    }
    const updated = updatedById.get(comp.id);
    if (updated) {
      const merged: FlowComponent = {
        ...comp,
        label: updated.label,
        variable: comp.variableLocked && comp.variable ? comp.variable : updated.key,
        variableLocked: true,
      };
      if (updated.description !== undefined) merged.description = updated.description;
      if (updated.required !== undefined) merged.required = updated.required;
      if (updated.min !== undefined) merged.min = updated.min;
      if (updated.max !== undefined) merged.max = updated.max;
      if (updated.unit !== undefined) merged.unit = updated.unit;
      if (updated.options !== undefined) merged.options = updated.options.map((o) => ({ ...o }));
      result.push(merged);
    } else {
      result.push(comp);
    }
  }

  for (const field of updatedFields) {
    if (!existingById.has(field.id)) {
      const newComp: FlowComponent = {
        id: field.id,
        type: field.type as FlowComponent["type"],
        label: field.label,
        variable: field.key,
        variableLocked: true,
      };
      if (field.description !== undefined) newComp.description = field.description;
      if (field.required !== undefined) newComp.required = field.required;
      if (field.min !== undefined) newComp.min = field.min;
      if (field.max !== undefined) newComp.max = field.max;
      if (field.unit !== undefined) newComp.unit = field.unit;
      if (field.options !== undefined) newComp.options = field.options.map((o) => ({ ...o }));
      result.push(newComp);
    }
  }

  return result;
}

/**
 * Normalizes raw form submission values into QuoteFlow's `Answers` map keyed by stable `variable` identity.
 */
export function normalizeFormAnswers(rawValues: Record<string, unknown>, flow: Flow): Answers {
  const answers: Answers = {};
  const allComponents = [...(flow.contactFields ?? []), ...flow.components];

  for (const comp of allComponents) {
    if (!comp.variable) continue;
    const raw = rawValues[comp.variable] ?? rawValues[comp.id];
    if (raw === undefined || raw === null) continue;
    if (comp.type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) answers[comp.variable] = n;
    } else if (Array.isArray(raw)) {
      answers[comp.variable] = raw.map(String);
    } else {
      answers[comp.variable] = String(raw);
    }
  }

  return answers;
}
