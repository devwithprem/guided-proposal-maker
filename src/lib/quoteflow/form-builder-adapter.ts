import type { Answers } from "./engine";
import type { ComponentType, Condition, Flow, FlowComponent, Operator, Option } from "./types";
import type { FormDesign, FormFieldData, LayoutContainer } from "@devcode-tech/form-builder";
import { validateField as gamiflowValidateField } from "@devcode-tech/gamiflow-core";

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

export interface FormBuilderAdapterSchema {
  title: string;
  description: string;
  fields: FormFieldData[];
  containers: LayoutContainer[];
  design: FormDesign;
  schema: {
    id: string;
    name: string;
    title: string;
    description: string;
    fields: FormFieldData[];
    containers: LayoutContainer[];
    design: FormDesign;
  };
}

export const NON_INPUT_COMPONENT_TYPES = new Set([
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
 * Converts a QuoteFlow `Condition` to Form Builder's `conditionalLogic` structure.
 */
export function conditionToConditionalLogic(
  condition?: Condition,
): FormFieldData["conditionalLogic"] | undefined {
  if (!condition || !condition.variable) return undefined;
  let cond = condition.operator as string;
  if (cond === "gt") cond = "greater_than";
  if (cond === "lt") cond = "less_than";
  return {
    dependsOn: condition.variable,
    condition: cond,
    value: condition.value,
  };
}

/**
 * Converts Form Builder's `conditionalLogic` structure to QuoteFlow `Condition`.
 */
export function conditionalLogicToCondition(
  logic?: FormFieldData["conditionalLogic"],
): Condition | undefined {
  if (!logic || !logic.dependsOn) return undefined;
  let op: Operator = "equals";
  const cond = String(logic.condition || "equals");
  if (cond === "greater_than" || cond === "gt") op = "gt";
  else if (cond === "less_than" || cond === "lt") op = "lt";
  else if (cond === "not_equals" || cond === "neq") op = "not_equals";
  else if (cond === "contains") op = "contains";
  else op = "equals";

  const condition: Condition = {
    id: `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    variable: logic.dependsOn,
    operator: op,
    value: logic.value !== undefined && logic.value !== null ? String(logic.value) : "",
  };
  return condition;
}

/**
 * Converts a QuoteFlow `FlowComponent` to Form Builder `FormFieldData`.
 */
export function componentToFormFieldData(comp: FlowComponent): FormFieldData {
  const variable = comp.variable ?? comp.id;
  const field: FormFieldData = {
    id: comp.id,
    type: comp.type,
    label: comp.label,
    name: variable,
    mapping: variable,
  };

  if (comp.description !== undefined && comp.description !== "") {
    field.placeholder = comp.description;
  }
  if (comp.required !== undefined) {
    field.required = comp.required;
  }
  if (comp.min !== undefined) {
    field.min = comp.min;
  }
  if (comp.max !== undefined) {
    field.max = comp.max;
  }
  if (comp.min !== undefined || comp.max !== undefined || comp.required !== undefined) {
    field["validation"] = {
      ...(comp.required !== undefined ? { required: comp.required } : {}),
      ...(comp.min !== undefined ? { min: comp.min } : {}),
      ...(comp.max !== undefined ? { max: comp.max } : {}),
    };
  }
  if (comp.options && comp.options.length > 0) {
    field.options = comp.options.map((o) => ({ id: o.id, label: o.label, value: o.value }));
  }
  const condLogic = conditionToConditionalLogic(comp.showWhen);
  if (condLogic) {
    field.conditionalLogic = condLogic;
  }

  return field;
}

/**
 * Converts Form Builder `FormFieldData` back to a QuoteFlow `FlowComponent`,
 * preserving variable lock status, existing options identity, and non-input metadata.
 */
export function formFieldDataToComponent(
  field: FormFieldData,
  existing?: FlowComponent,
): FlowComponent {
  const baseType = (field.type as ComponentType) || (existing ? existing.type : "text");
  const comp: FlowComponent = {
    id: field.id,
    type: baseType,
    label: field.label || (existing ? existing.label : "Untitled Question"),
  };

  // Variable identity preservation
  const candidateVar = field.mapping || field.name;
  if (existing?.variableLocked && existing.variable) {
    comp.variable = existing.variable;
    comp.variableLocked = true;
  } else if (candidateVar) {
    comp.variable = candidateVar;
    comp.variableLocked = true;
  } else if (existing?.variable) {
    comp.variable = existing.variable;
    comp.variableLocked = true;
  } else {
    comp.variable = field.id;
    comp.variableLocked = true;
  }

  if (field.placeholder !== undefined && field.placeholder !== "") {
    comp.description = field.placeholder;
  } else if (existing?.description !== undefined) {
    comp.description = existing.description;
  }

  if (field.required !== undefined) {
    comp.required = Boolean(field.required);
  } else if (existing?.required !== undefined) {
    comp.required = existing.required;
  }

  const vValidation = field["validation"] as { min?: number | undefined; max?: number | undefined } | undefined;
  const vMin = typeof field.min === "number" ? field.min : vValidation?.min;
  const vMax = typeof field.max === "number" ? field.max : vValidation?.max;

  if (vMin !== undefined) {
    comp.min = vMin;
  } else if (existing?.min !== undefined) {
    comp.min = existing.min;
  }

  if (vMax !== undefined) {
    comp.max = vMax;
  } else if (existing?.max !== undefined) {
    comp.max = existing.max;
  }

  if (existing?.unit !== undefined) {
    comp.unit = existing.unit;
  }

  if (field.options && Array.isArray(field.options) && field.options.length > 0) {
    const existingOptMap = new Map((existing?.options ?? []).map((o) => [o.value, o]));
    comp.options = (field.options as Array<{ id?: string; label?: string; value: string }>).map((opt, idx) => {
      const match = existingOptMap.get(opt.value);
      return {
        id: opt.id || match?.id || `opt_${idx}`,
        label: opt.label || match?.label || opt.value,
        value: opt.value,
      };
    });
  } else if (existing?.options !== undefined) {
    comp.options = existing.options.map((o) => ({ ...o }));
  }

  const cond = conditionalLogicToCondition(field.conditionalLogic);
  if (cond) {
    comp.showWhen = cond;
  } else if (existing?.showWhen) {
    comp.showWhen = existing.showWhen;
  }

  // Preserve calculation if previously attached
  if (existing?.calculation) {
    comp.calculation = existing.calculation;
  }

  return comp;
}

/**
 * Converts a QuoteFlow `Flow` into a full Form Builder schema object
 * with fields, containers, and theme design.
 */
export function toFormBuilderSchema(
  flow: Flow,
  options?: { includeContactFields?: boolean },
): FormBuilderAdapterSchema {
  const componentsToConvert = options?.includeContactFields
    ? [...(flow.contactFields ?? []), ...getCustomerQuestionComponents(flow)]
    : getCustomerQuestionComponents(flow);

  const fields = componentsToConvert.map(componentToFormFieldData);
  const containerId = `container_${flow.id}`;
  const containers: LayoutContainer[] = [
    {
      id: containerId,
      type: "single-column",
      columns: 1,
      children: fields.map((f) => f.id),
    },
  ];

  const design: FormDesign = {
    backgroundColor: "#ffffff",
    fontFamily: "font-sans",
    fontSize: "text-base",
    labelColor: "#374151",
    inputTextColor: "#111827",
    helperColor: "#6B7280",
    inputBorderColor: "#D1D5DB",
    brandColor: "#0f766e",
    spacing: {
      container: "p-6",
      fields: "space-y-5",
      columnGap: "1.5rem",
      rowGap: "1.5rem",
      fieldSpacing: "1.25rem",
    },
    submitButton: {
      text: flow.settings?.submitLabel || "Submit",
      backgroundColor: "#0f766e",
      textColor: "#ffffff",
    },
  };

  return {
    title: flow.name,
    description: flow.description || "",
    fields,
    containers,
    design,
    schema: {
      id: flow.id,
      name: flow.name,
      title: flow.name,
      description: flow.description || "",
      fields,
      containers,
      design,
    },
  };
}

/**
 * Merges updated fields from Form Builder back into QuoteFlow's `Flow`,
 * preserving all calculations, standalone variables, price summaries, recommendations,
 * and locked variable names without loss of domain metadata.
 */
export function mergeFormBuilderDataIntoFlow(
  existingFlow: Flow,
  data: { fields: FormFieldData[]; containers?: LayoutContainer[] },
): Flow {
  const incomingFields = data.fields ?? [];
  const incomingById = new Map(incomingFields.map((f) => [f.id, f]));
  const contactFieldIds = new Set((existingFlow.contactFields ?? []).map((c) => c.id));

  // 1. Update contact fields if any match
  const updatedContactFields = (existingFlow.contactFields ?? []).map((cf) => {
    const updated = incomingById.get(cf.id);
    return updated ? formFieldDataToComponent(updated, cf) : cf;
  });

  // 2. Identify fields intended for components
  const existingComponentsById = new Map(existingFlow.components.map((c) => [c.id, c]));
  const updatedComponents: FlowComponent[] = [];

  // Determine field order from containers if available, otherwise from fields array
  let orderedFieldIds: string[] = [];
  if (data.containers && data.containers.length > 0) {
    orderedFieldIds = data.containers.flatMap((c) => c.children ?? []);
  }
  if (orderedFieldIds.length === 0) {
    orderedFieldIds = incomingFields.map((f) => f.id);
  }

  // Preserve non-input components and update existing questions
  for (const comp of existingFlow.components) {
    if (NON_INPUT_COMPONENT_TYPES.has(comp.type)) {
      updatedComponents.push(comp);
      continue;
    }
    const incoming = incomingById.get(comp.id);
    if (incoming) {
      updatedComponents.push(formFieldDataToComponent(incoming, comp));
    } else {
      updatedComponents.push(comp);
    }
  }

  // Append new fields added through the Form Builder
  for (const fieldId of orderedFieldIds) {
    if (contactFieldIds.has(fieldId)) continue;
    if (!existingComponentsById.has(fieldId)) {
      const fieldData = incomingById.get(fieldId);
      if (fieldData) {
        updatedComponents.push(formFieldDataToComponent(fieldData));
      }
    }
  }

  return {
    ...existingFlow,
    contactFields: updatedContactFields,
    components: updatedComponents,
  };
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
      if (typeof raw === "string" && raw.trim() === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) answers[comp.variable] = n;
    } else if (comp.type === "multiselect" || comp.type === "checkbox") {
      if (Array.isArray(raw)) {
        answers[comp.variable] = raw.map(String).filter((s) => s.trim() !== "");
      } else if (typeof raw === "string" && raw.trim() !== "") {
        answers[comp.variable] = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        answers[comp.variable] = [];
      }
    } else if (Array.isArray(raw)) {
      answers[comp.variable] = raw.map(String);
    } else if (typeof raw === "boolean") {
      answers[comp.variable] = raw ? "true" : "false";
    } else {
      answers[comp.variable] = String(raw);
    }
  }

  return answers;
}

/**
 * Sanitizes a customer product quantity map so only positive finite integers (1..9999) are retained.
 */
export function sanitizeProductQuantities(
  rawQuantities: Record<string, unknown>,
  validProductIds?: ReadonlySet<string>,
): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const [productId, rawVal] of Object.entries(rawQuantities)) {
    if (validProductIds && !validProductIds.has(productId)) continue;
    const n = Number(rawVal);
    if (Number.isFinite(n) && n >= 1) {
      clean[productId] = Math.min(9999, Math.floor(n));
    }
  }
  return clean;
}

/**
 * Validates a component's value using `@devcode-tech/gamiflow-core` validation engine
 * plus explicit QuoteFlow domain rules (option membership, multi-select required checks, and numeric bounds).
 */
export function validateFlowField(
  comp: FlowComponent,
  value: unknown,
): string | null {
  const isEmpty =
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "number" && !Number.isFinite(value));

  if (comp.required && isEmpty) {
    return `${comp.label} is required.`;
  }

  if (isEmpty) {
    return null;
  }

  if (comp.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return `Please enter a valid number for ${comp.label}.`;
    }
    if (comp.min !== undefined && n < comp.min) {
      return `${comp.label} must be at least ${comp.min}.`;
    }
    if (comp.max !== undefined && n > comp.max) {
      return `${comp.label} must be at most ${comp.max}.`;
    }
  }

  if (comp.type === "email") {
    const emailStr = String(value).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return `Please enter a valid email address.`;
    }
  }

  if (comp.type === "date") {
    const dStr = String(value).trim();
    if (isNaN(Date.parse(dStr))) {
      return `Please enter a valid date for ${comp.label}.`;
    }
  }

  if ((comp.type === "dropdown" || comp.type === "radio") && comp.options && comp.options.length > 0) {
    const allowed = new Set(comp.options.map((o) => o.value));
    if (!allowed.has(String(value))) {
      return `Please select a valid option for ${comp.label}.`;
    }
  }

  if ((comp.type === "multiselect" || comp.type === "checkbox") && comp.options && comp.options.length > 0) {
    const allowed = new Set(comp.options.map((o) => o.value));
    const items = Array.isArray(value) ? value : [String(value)];
    if (items.some((item) => !allowed.has(String(item)))) {
      return `One or more selected options for ${comp.label} are invalid.`;
    }
  }

  const fieldData = componentToFormFieldData(comp);
  return gamiflowValidateField(fieldData as unknown as Parameters<typeof gamiflowValidateField>[0], value) ?? null;
}
