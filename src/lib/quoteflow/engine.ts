import type {
  Action,
  Calculation,
  Condition,
  Enquiry,
  Flow,
  FlowComponent,
  Operator,
  Package,
  Product,
  Proposal,
  ProposalSnapshot,
  QuoteLine,
  QuoteSnapshot,
  Rule,
  WorkspaceData,
} from "./types";
import { defaultWorkspaceSettings } from "./defaults";

export type { QuoteLine };

export type Answers = Record<string, string | number | string[] | undefined>;

export const operatorLabels: Record<Operator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  gt: "is greater than",
  lt: "is less than",
  gte: "is greater than or equal to",
  lte: "is less than or equal to",
  contains: "contains",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export const actionLabels: Record<Action["type"], string> = {
  show: "Show",
  hide: "Hide",
  recommend: "Recommend",
  add_to_quote: "Add to Quote",
  remove_from_quote: "Remove from Quote",
  set_value: "Set Value",
  add_fee: "Add Fee",
  apply_discount: "Apply Discount",
  set_score: "Set Score",
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function evaluateCondition(c: Condition, answers: Answers): boolean {
  const raw = answers[c.variable];
  const str = Array.isArray(raw) ? raw.join(",") : raw === undefined || raw === null ? "" : String(raw);
  switch (c.operator) {
    case "equals":
      return str.toLowerCase() === c.value.trim().toLowerCase();
    case "not_equals":
      return str.toLowerCase() !== c.value.trim().toLowerCase();
    case "gt":
      return num(raw) > num(c.value);
    case "lt":
      return num(raw) < num(c.value);
    case "gte":
      return num(raw) >= num(c.value);
    case "lte":
      return num(raw) <= num(c.value);
    case "contains":
      return str.toLowerCase().includes(c.value.trim().toLowerCase());
    case "is_empty":
      return str.length === 0;
    case "is_not_empty":
      return str.length > 0;
    default:
      return false;
  }
}

export function evaluateRule(rule: Rule, answers: Answers): boolean {
  if (!rule.conditions.length) return false;
  return rule.match === "all"
    ? rule.conditions.every((c) => evaluateCondition(c, answers))
    : rule.conditions.some((c) => evaluateCondition(c, answers));
}

export function runCalculation(calc: Calculation, answers: Answers): number {
  let total = 0;
  calc.terms.forEach((t, i) => {
    const v = t.kind === "number" ? (t.number ?? 0) : num(answers[t.variable ?? ""]);
    if (i === 0) {
      total = v;
      return;
    }
    switch (t.operator) {
      case "-":
        total -= v;
        break;
      case "×":
        total *= v;
        break;
      case "÷":
        total = v === 0 ? total : total / v;
        break;
      default:
        total += v;
    }
  });
  return Math.round(total * 100) / 100;
}

export interface EngineResult {
  matchedRules: Rule[];
  messages: string[];
  recommendedProducts: Product[];
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
  score: number;
  hiddenComponentIds: string[];
  calculations: { name: string; variable: string; value: number }[];
}

export function runEngine(opts: {
  flow: Flow;
  answers: Answers;
  products: Product[];
  packages: Package[];
  selectedAddons?: string[];
}): EngineResult {
  const { flow, products, packages, selectedAddons = [] } = opts;
  const answers: Answers = { ...opts.answers };
  const calculations: EngineResult["calculations"] = [];

  for (const c of flow.components) {
    if (c.type === "calculation" && c.calculation) {
      const value = runCalculation(c.calculation, answers);
      answers[c.calculation.resultVariable] = value;
      calculations.push({ name: c.calculation.name, variable: c.calculation.resultVariable, value });
    }
  }

  const matchedRules: Rule[] = [];
  const messages: string[] = [];
  const recommendedIds = new Set<string>();
  const removedIds = new Set<string>();
  const hiddenComponentIds: string[] = [];
  const fees: QuoteLine[] = [];
  let discount = 0;
  let score = 0;

  for (const rule of flow.rules) {
    if (!rule.active) continue;
    if (!evaluateRule(rule, answers)) continue;
    matchedRules.push(rule);
    for (const a of rule.actions) {
      const product = a.targetKind === "product" ? products.find((p) => p.id === a.targetId) : undefined;
      const pack = a.targetKind === "package" ? packages.find((p) => p.id === a.targetId) : undefined;
      switch (a.type) {
        case "recommend":
        case "add_to_quote":
          if (product) {
            recommendedIds.add(product.id);
            messages.push(`${actionLabels[a.type]}: ${product.name}`);
          } else if (pack) {
            messages.push(`${actionLabels[a.type]}: ${pack.name}`);
          }
          break;
        case "remove_from_quote":
          if (product) {
            removedIds.add(product.id);
            messages.push(`Removed ${product.name} from the quote`);
          }
          break;
        case "add_fee":
          fees.push({
            id: a.id,
            label: a.label || "Fee",
            amount: a.amount ?? 0,
            source: "fee",
            sourceRuleId: rule.id,
          });
          messages.push(`${a.label || "Fee"} added ($${a.amount ?? 0})`);
          break;
        case "apply_discount":
          discount += a.amount ?? 0;
          messages.push(`Discount applied ($${a.amount ?? 0})`);
          break;
        case "set_score":
          score += a.amount ?? 0;
          messages.push(`Score +${a.amount ?? 0}`);
          break;
        case "set_value":
          if (a.variable) {
            answers[a.variable] = a.value ?? "";
            messages.push(`${a.variable} set to ${a.value}`);
          }
          break;
        case "hide":
          if (a.targetId) hiddenComponentIds.push(a.targetId);
          messages.push(`Hidden: ${flow.components.find((c) => c.id === a.targetId)?.label ?? "question"}`);
          break;
        case "show":
          messages.push(`Shown: ${flow.components.find((c) => c.id === a.targetId)?.label ?? "question"}`);
          break;
      }
    }
  }

  for (const c of [...flow.components, ...(flow.contactFields ?? [])]) {
    if (c.showWhen && c.showWhen.variable && !evaluateCondition(c.showWhen, answers)) hiddenComponentIds.push(c.id);
  }

  const recommendedProducts = products.filter((p) => recommendedIds.has(p.id) && !removedIds.has(p.id));
  const lines: QuoteLine[] = [];
  const basePackage = packages.find((p) => p.id === flow.basePackageId);
  if (basePackage) {
    lines.push({
      id: basePackage.id,
      label: basePackage.name,
      detail: "Base package",
      amount: basePackage.price,
      source: "package",
      targetId: basePackage.id,
    });
    for (const addon of basePackage.addons) {
      if (selectedAddons.includes(addon.id)) {
        lines.push({
          id: addon.id,
          label: addon.name,
          detail: "Add-on",
          amount: addon.price,
          source: "addon",
          targetId: addon.id,
        });
      }
    }
  }
  for (const p of recommendedProducts) {
    lines.push({
      id: p.id,
      label: p.name,
      detail: p.description,
      amount: p.price,
      source: "recommended",
      targetId: p.id,
    });
  }
  lines.push(...fees);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = Math.max(0, subtotal - discount);
  return {
    matchedRules,
    messages,
    recommendedProducts,
    lines,
    subtotal,
    discount,
    total,
    score,
    hiddenComponentIds,
    calculations,
  };
}

/**
 * Pure helper to convert an EngineResult into an immutable QuoteSnapshot.
 */
export function createQuoteSnapshot(flow: Flow, result: EngineResult): QuoteSnapshot {
  const snapshot: QuoteSnapshot = {
    capturedAt: new Date().toISOString(),
    flowId: flow.id,
    lines: result.lines.map((l) => ({ ...l })),
    subtotal: result.subtotal,
    discount: result.discount,
    total: result.total,
    score: result.score,
    matchedRuleIds: result.matchedRules.map((r) => r.id),
    recommendedProductIds: result.recommendedProducts.map((p) => p.id),
    calculations: result.calculations.map((c) => ({ ...c })),
  };
  if (flow.basePackageId !== undefined) {
    snapshot.basePackageId = flow.basePackageId;
  }
  return snapshot;
}

/**
 * Pure helper to build a ProposalSnapshot from an enquiry, flow, and workspace state.
 */
export function createProposalSnapshot(opts: {
  enquiry: Enquiry;
  flow: Flow;
  result: EngineResult;
  ws: WorkspaceData;
  revision?: number | undefined;
}): ProposalSnapshot {
  const { enquiry, flow, result, ws, revision = 1 } = opts;
  const settings = ws.settings ?? defaultWorkspaceSettings();
  const basePackage = ws.packages.find((p) => p.id === flow.basePackageId);
  const allComponents = [...(flow.contactFields ?? []), ...flow.components];

  const formattedAnswers = Object.entries(enquiry.answers).map(([variable, val]) => {
    const comp = allComponents.find((c) => c.variable === variable);
    return {
      variable,
      label: comp?.label ?? variable,
      value: Array.isArray(val) ? val.join(", ") : String(val),
    };
  });

  const snapshot: ProposalSnapshot = {
    revision,
    capturedAt: new Date().toISOString(),
    customer: enquiry.customer,
    email: enquiry.email,
    business: enquiry.business,
    template: flow.settings.proposalTemplate,
    answers: formattedAnswers,
    quote: createQuoteSnapshot(flow, result),
    terms: settings.terms,
    validityDays: settings.validityDays,
    depositPercent: settings.depositPercent,
  };

  if (enquiry.eventDate !== undefined) snapshot.eventDate = enquiry.eventDate;
  if (enquiry.location !== undefined) snapshot.location = enquiry.location;
  if (basePackage) {
    snapshot.basePackage = {
      id: basePackage.id,
      name: basePackage.name,
      description: basePackage.description,
      price: basePackage.price,
      includes: [...basePackage.includes],
    };
  }

  return snapshot;
}

/**
 * Evaluates a single enquiry's quote using the workspace catalog.
 */
export function evaluateEnquiryQuote(enquiry: Enquiry, ws: WorkspaceData): EngineResult | null {
  const flow = ws.flows.find((f) => f.id === enquiry.flowId);
  if (!flow) return null;
  return runEngine({
    flow,
    answers: enquiry.answers,
    products: ws.products,
    packages: ws.packages,
    selectedAddons: enquiry.selectedAddons,
  });
}

/**
 * Returns the authoritative total for a proposal: reads the immutable snapshot if present,
 * falling back to evaluating the enquiry's quote for legacy unsnapshotted records.
 */
export function getProposalTotal(proposal: Proposal, ws: WorkspaceData): number {
  if (proposal.snapshot) {
    return proposal.snapshot.quote.total;
  }
  const enquiry = ws.enquiries.find((e) => e.id === proposal.enquiryId);
  if (!enquiry) return 0;
  return evaluateEnquiryQuote(enquiry, ws)?.total ?? 0;
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function slugToVariable(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Generates a unique, non-empty variable slug within a Flow so newly created fields
 * never collide with existing question or calculation variables.
 */
export function createUniqueVariable(baseLabel: string, flow: Flow, excludeComponentId?: string): string {
  const base = slugToVariable(baseLabel) || "field";
  const existing = new Set<string>();
  for (const c of [...(flow.contactFields ?? []), ...flow.components]) {
    if (c.id === excludeComponentId) continue;
    if (c.variable) existing.add(c.variable);
    if (c.type === "calculation" && c.calculation?.resultVariable) {
      existing.add(c.calculation.resultVariable);
    }
  }
  if (!existing.has(base)) return base;
  let counter = 2;
  while (existing.has(`${base}_${counter}`)) {
    counter++;
  }
  return `${base}_${counter}`;
}

export interface VariableRenameResult {
  flow: Flow;
  success: boolean;
  renamedCount: {
    conditions: number;
    actions: number;
    terms: number;
    visibility: number;
  };
  error?: string | undefined;
}

/**
 * Renames a variable safely across the flow, updating showWhen conditions,
 * calculation terms, and rule conditions/actions. Prevents duplicate variables.
 */
export function renameFlowVariable(
  flow: Flow,
  oldVar: string,
  newVarRaw: string,
  targetComponentId?: string,
): VariableRenameResult {
  const newVar = slugToVariable(newVarRaw);
  if (!newVar) {
    return {
      flow,
      success: false,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
      error: "Variable name cannot be empty",
    };
  }

  if (oldVar === newVar) {
    return {
      flow,
      success: true,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
    };
  }

  const existingVars = new Set<string>();
  for (const c of [...(flow.contactFields ?? []), ...flow.components]) {
    if (c.id === targetComponentId) continue;
    if (c.variable) existingVars.add(c.variable);
    if (c.type === "calculation" && c.calculation?.resultVariable) {
      existingVars.add(c.calculation.resultVariable);
    }
  }

  if (existingVars.has(newVar)) {
    return {
      flow,
      success: false,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
      error: `Variable "${newVar}" already exists in this flow`,
    };
  }

  let conditionsCount = 0;
  let actionsCount = 0;
  let termsCount = 0;
  let visibilityCount = 0;

  const updateComp = (c: FlowComponent): FlowComponent => {
    let updated = c;
    if (c.id === targetComponentId || (oldVar && c.variable === oldVar)) {
      updated = { ...updated, variable: newVar, variableLocked: true };
    }
    if (updated.showWhen && updated.showWhen.variable === oldVar) {
      updated = {
        ...updated,
        showWhen: { ...updated.showWhen, variable: newVar },
      };
      visibilityCount++;
    }
    if (updated.type === "calculation" && updated.calculation) {
      let calcChanged = false;
      const nextTerms = updated.calculation.terms.map((t) => {
        if (t.kind === "variable" && t.variable === oldVar) {
          calcChanged = true;
          termsCount++;
          return { ...t, variable: newVar };
        }
        return t;
      });
      if (calcChanged) {
        updated = {
          ...updated,
          calculation: { ...updated.calculation, terms: nextTerms },
        };
      }
    }
    return updated;
  };

  const contactFields = (flow.contactFields ?? []).map(updateComp);
  const components = flow.components.map(updateComp);

  const rules = flow.rules.map((r) => {
    let ruleChanged = false;
    const conditions = r.conditions.map((cond) => {
      if (cond.variable === oldVar) {
        ruleChanged = true;
        conditionsCount++;
        return { ...cond, variable: newVar };
      }
      return cond;
    });
    const actions = r.actions.map((act) => {
      if (act.variable === oldVar) {
        ruleChanged = true;
        actionsCount++;
        return { ...act, variable: newVar };
      }
      return act;
    });
    return ruleChanged ? { ...r, conditions, actions } : r;
  });

  return {
    flow: { ...flow, contactFields, components, rules },
    success: true,
    renamedCount: {
      conditions: conditionsCount,
      actions: actionsCount,
      terms: termsCount,
      visibility: visibilityCount,
    },
  };
}

/**
 * Renames a calculation's result variable safely across the flow,
 * updating rules and other calculations that reference it.
 */
export function renameCalculationResultVariable(
  flow: Flow,
  componentId: string,
  newVarRaw: string,
): VariableRenameResult {
  const comp = flow.components.find((c) => c.id === componentId);
  const oldVar = comp?.calculation?.resultVariable ?? "";
  const newVar = slugToVariable(newVarRaw);

  if (!newVar) {
    return {
      flow,
      success: false,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
      error: "Calculation variable name cannot be empty",
    };
  }

  if (oldVar === newVar) {
    return {
      flow,
      success: true,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
    };
  }

  const existingVars = new Set<string>();
  for (const c of [...(flow.contactFields ?? []), ...flow.components]) {
    if (c.variable) existingVars.add(c.variable);
    if (c.id !== componentId && c.type === "calculation" && c.calculation?.resultVariable) {
      existingVars.add(c.calculation.resultVariable);
    }
  }

  if (existingVars.has(newVar)) {
    return {
      flow,
      success: false,
      renamedCount: { conditions: 0, actions: 0, terms: 0, visibility: 0 },
      error: `Variable "${newVar}" already exists in this flow`,
    };
  }

  let conditionsCount = 0;
  let actionsCount = 0;
  let termsCount = 0;
  let visibilityCount = 0;

  const components = flow.components.map((c) => {
    let updated = c;
    if (c.id === componentId && c.calculation) {
      updated = {
        ...updated,
        calculation: { ...c.calculation, resultVariable: newVar },
      };
    }
    if (updated.showWhen && updated.showWhen.variable === oldVar) {
      updated = {
        ...updated,
        showWhen: { ...updated.showWhen, variable: newVar },
      };
      visibilityCount++;
    }
    if (updated.type === "calculation" && updated.calculation && c.id !== componentId) {
      let termsChanged = false;
      const nextTerms = updated.calculation.terms.map((t) => {
        if (t.kind === "variable" && t.variable === oldVar) {
          termsChanged = true;
          termsCount++;
          return { ...t, variable: newVar };
        }
        return t;
      });
      if (termsChanged) {
        updated = {
          ...updated,
          calculation: { ...updated.calculation, terms: nextTerms },
        };
      }
    }
    return updated;
  });

  const contactFields = (flow.contactFields ?? []).map((c) => {
    if (c.showWhen && c.showWhen.variable === oldVar) {
      visibilityCount++;
      return { ...c, showWhen: { ...c.showWhen, variable: newVar } };
    }
    return c;
  });

  const rules = flow.rules.map((r) => {
    let changed = false;
    const conditions = r.conditions.map((cond) => {
      if (cond.variable === oldVar) {
        changed = true;
        conditionsCount++;
        return { ...cond, variable: newVar };
      }
      return cond;
    });
    const actions = r.actions.map((act) => {
      if (act.variable === oldVar) {
        changed = true;
        actionsCount++;
        return { ...act, variable: newVar };
      }
      return act;
    });
    return changed ? { ...r, conditions, actions } : r;
  });

  return {
    flow: { ...flow, components, contactFields, rules },
    success: true,
    renamedCount: {
      conditions: conditionsCount,
      actions: actionsCount,
      terms: termsCount,
      visibility: visibilityCount,
    },
  };
}

/**
 * Safely renames an option value, updating rule conditions and visibility checks.
 */
export function renameFlowOptionValue(
  flow: Flow,
  componentId: string,
  optionId: string,
  newValRaw: string,
): Flow {
  const comp = flow.components.find((c) => c.id === componentId);
  if (!comp || !comp.options) return flow;
  const opt = comp.options.find((o) => o.id === optionId);
  if (!opt) return flow;

  const oldVal = opt.value;
  const newVal = slugToVariable(newValRaw) || newValRaw;
  if (oldVal === newVal) return flow;

  const nextOptions = comp.options.map((o) => (o.id === optionId ? { ...o, value: newVal } : o));
  const compVar = comp.variable;

  const nextComponents = flow.components.map((c) => {
    if (c.id === componentId) {
      return { ...c, options: nextOptions };
    }
    if (compVar && c.showWhen && c.showWhen.variable === compVar && c.showWhen.value === oldVal) {
      return { ...c, showWhen: { ...c.showWhen, value: newVal } };
    }
    return c;
  });

  const nextContactFields = (flow.contactFields ?? []).map((c) => {
    if (compVar && c.showWhen && c.showWhen.variable === compVar && c.showWhen.value === oldVal) {
      return { ...c, showWhen: { ...c.showWhen, value: newVal } };
    }
    return c;
  });

  const nextRules = flow.rules.map((r) => {
    if (!compVar) return r;
    let changed = false;
    const conditions = r.conditions.map((cond) => {
      if (cond.variable === compVar && cond.value === oldVal) {
        changed = true;
        return { ...cond, value: newVal };
      }
      return cond;
    });
    const actions = r.actions.map((act) => {
      if (act.variable === compVar && act.value === oldVal) {
        changed = true;
        return { ...act, value: newVal };
      }
      return act;
    });
    return changed ? { ...r, conditions, actions } : r;
  });

  return {
    ...flow,
    components: nextComponents,
    contactFields: nextContactFields,
    rules: nextRules,
  };
}

/**
 * Migrates an Enquiry answers map when a flow variable is renamed.
 */
export function migrateEnquiryAnswersOnVariableRename(
  enquiry: Enquiry,
  oldVar: string,
  newVar: string,
): Enquiry {
  if (oldVar === newVar || !(oldVar in enquiry.answers)) return enquiry;
  const nextAnswers = { ...enquiry.answers };
  const val = nextAnswers[oldVar];
  if (val !== undefined) {
    nextAnswers[newVar] = val;
    delete nextAnswers[oldVar];
  }
  return { ...enquiry, answers: nextAnswers };
}

export function flowVariables(flow: Flow) {
  const vars: {
    variable: string;
    label: string;
    options?: { label: string; value: string }[] | undefined;
    type: string;
  }[] = [];
  for (const c of flow.components) {
    if (c.variable) vars.push({ variable: c.variable, label: c.label, options: c.options, type: c.type });
    if (c.type === "calculation" && c.calculation)
      vars.push({ variable: c.calculation.resultVariable, label: c.calculation.name, type: "calculation" });
  }
  return vars;
}
