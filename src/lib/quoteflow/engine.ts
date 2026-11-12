import type {
  Action,
  Calculation,
  CalcTerm,
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

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Validates whether a condition is complete and safe to evaluate.
 * Prevents unconfigured or partially configured conditions from triggering unintended actions.
 */
export function isConditionComplete(c: Condition): boolean {
  if (!c.variable || c.variable.trim() === "") return false;
  if (!c.operator) return false;
  if (c.operator === "is_empty" || c.operator === "is_not_empty") return true;
  return c.value !== undefined && c.value !== null && c.value.trim() !== "";
}

/**
 * Evaluates a single condition against the current answers map.
 * Safely handles missing values, numbers, strings, and multi-select arrays.
 */
export function evaluateCondition(c: Condition, answers: Answers): boolean {
  const raw = answers[c.variable];
  const targetVal = c.value ? c.value.trim().toLowerCase() : "";

  switch (c.operator) {
    case "is_empty":
      if (raw === undefined || raw === null) return true;
      if (Array.isArray(raw)) return raw.length === 0;
      return String(raw).trim().length === 0;

    case "is_not_empty":
      if (raw === undefined || raw === null) return false;
      if (Array.isArray(raw)) return raw.length > 0;
      return String(raw).trim().length > 0;

    case "equals":
      if (Array.isArray(raw)) {
        return raw.some((item) => String(item).toLowerCase().trim() === targetVal);
      }
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        return targetVal === "";
      }
      const nRawEq = Number(raw);
      const nValEq = Number(c.value);
      if (Number.isFinite(nRawEq) && Number.isFinite(nValEq) && c.value.trim() !== "") {
        return nRawEq === nValEq;
      }
      return String(raw).toLowerCase().trim() === targetVal;

    case "not_equals":
      if (Array.isArray(raw)) {
        return !raw.some((item) => String(item).toLowerCase().trim() === targetVal);
      }
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        return targetVal !== "";
      }
      const nRawNeq = Number(raw);
      const nValNeq = Number(c.value);
      if (Number.isFinite(nRawNeq) && Number.isFinite(nValNeq) && c.value.trim() !== "") {
        return nRawNeq !== nValNeq;
      }
      return String(raw).toLowerCase().trim() !== targetVal;

    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      if (raw === undefined || raw === null || String(raw).trim() === "") return false;
      const nRaw = Number(raw);
      const nVal = Number(c.value);
      if (!Number.isFinite(nRaw) || !Number.isFinite(nVal)) return false;
      if (c.operator === "gt") return nRaw > nVal;
      if (c.operator === "lt") return nRaw < nVal;
      if (c.operator === "gte") return nRaw >= nVal;
      if (c.operator === "lte") return nRaw <= nVal;
      return false;
    }

    case "contains":
      if (raw === undefined || raw === null) return false;
      if (Array.isArray(raw)) {
        return raw.some((item) => String(item).toLowerCase().includes(targetVal));
      }
      return String(raw).toLowerCase().includes(targetVal);

    default:
      return false;
  }
}

/**
 * Evaluates a rule against answers.
 * Implements fail-closed safety for ALL rules: if ANY condition in an ALL rule is incomplete,
 * the rule fails closed (returns false) to prevent unauthorized charges or accidental matching.
 */
export function evaluateRule(rule: Rule, answers: Answers): boolean {
  if (!rule.conditions || rule.conditions.length === 0) return false;

  if (rule.match === "all") {
    // Every condition must be complete AND pass
    for (const c of rule.conditions) {
      if (!isConditionComplete(c)) return false;
      if (!evaluateCondition(c, answers)) return false;
    }
    return true;
  }

  // ANY condition match: must have at least one complete condition that passes
  const completeConditions = rule.conditions.filter(isConditionComplete);
  if (completeConditions.length === 0) return false;
  return completeConditions.some((c) => evaluateCondition(c, answers));
}

export interface ComputedCalculation {
  id: string;
  name: string;
  variable: string;
  value: number;
  isReady: boolean;
  includeInQuote?: boolean | undefined;
}

export interface CalculationEvaluationResult {
  calculations: ComputedCalculation[];
  values: Record<string, number>;
  errors: string[];
}

/**
 * Topologically sorts and evaluates calculations, detecting circular dependencies
 * and safely handling missing operands or divide-by-zero.
 */
export function evaluateCalculations(
  components: FlowComponent[],
  answers: Answers,
): CalculationEvaluationResult {
  const calcComponents = components.filter(
    (c) => c.type === "calculation" && Boolean(c.calculation),
  );

  const calcs = calcComponents.map((c) => c.calculation!);
  const calcByResultVar = new Map<string, Calculation>();
  for (const calc of calcs) {
    if (calc.resultVariable) {
      calcByResultVar.set(calc.resultVariable, calc);
    }
  }

  // Build dependency graph
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const calc of calcs) {
    adj.set(calc.id, []);
    inDegree.set(calc.id, 0);
  }

  for (const calc of calcs) {
    for (const term of calc.terms) {
      if (term.kind === "variable" && term.variable) {
        const depCalc = calcByResultVar.get(term.variable);
        if (depCalc && depCalc.id !== calc.id) {
          adj.get(depCalc.id)?.push(calc.id);
          inDegree.set(calc.id, (inDegree.get(calc.id) ?? 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const orderedCalcs: Calculation[] = [];
  const errors: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const calc = calcs.find((c) => c.id === id);
    if (calc) orderedCalcs.push(calc);

    const neighbors = adj.get(id) ?? [];
    for (const n of neighbors) {
      const newDeg = (inDegree.get(n) ?? 1) - 1;
      inDegree.set(n, newDeg);
      if (newDeg === 0) queue.push(n);
    }
  }

  // Check for circular dependency
  if (orderedCalcs.length < calcs.length) {
    errors.push("Circular calculation dependency detected among flow calculations");
    // Append any unvisited calculations to avoid dropping them
    for (const calc of calcs) {
      if (!orderedCalcs.some((c) => c.id === calc.id)) {
        orderedCalcs.push(calc);
      }
    }
  }

  // Evaluate in sorted order
  const values: Record<string, number> = {};
  const currentAnswers: Answers = { ...answers };
  const computedList: ComputedCalculation[] = [];

  for (const calc of orderedCalcs) {
    let total = 0;
    let isReady = true;

    calc.terms.forEach((t, i) => {
      let v = 0;
      if (t.kind === "number") {
        v = t.number ?? 0;
      } else {
        const raw = currentAnswers[t.variable ?? ""];
        if (raw === undefined || raw === null || String(raw).trim() === "") {
          isReady = false;
          v = 0;
        } else {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            v = parsed;
          } else {
            isReady = false;
            v = 0;
          }
        }
      }

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
          if (v === 0) {
            errors.push(`Divide by zero in calculation "${calc.name}"`);
            total = 0;
          } else {
            total = total / v;
          }
          break;
        default:
          total += v;
      }
    });

    const finalVal = isReady ? Math.round(total * 100) / 100 : 0;
    values[calc.resultVariable] = finalVal;
    currentAnswers[calc.resultVariable] = finalVal;

    computedList.push({
      id: calc.id,
      name: calc.name,
      variable: calc.resultVariable,
      value: finalVal,
      isReady,
      includeInQuote: calc.includeInQuote,
    });
  }

  return { calculations: computedList, values, errors };
}

/** Legacy single-calculation runner for backward compatibility. */
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
        total = v === 0 ? 0 : total / v;
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
  errors: string[];
  converged: boolean;
  resolvedAnswers: Answers;
}

/**
 * Deterministic business evaluation engine.
 * Supports ALL/ANY rule logic, topological calculations, rule-driven visibility,
 * explicit product selection vs recommendations, and cycle protection for set_value loops.
 */
export function runEngine(opts: {
  flow: Flow;
  answers: Answers;
  products: Product[];
  packages: Package[];
  selectedAddons?: string[] | undefined;
  selectedProducts?: string[] | undefined;
}): EngineResult {
  const { flow, products, packages, selectedAddons = [], selectedProducts = [] } = opts;
  const errors: string[] = [];
  let currentAnswers: Answers = { ...opts.answers };

  // Phase 1: Convergence loop for calculations and set_value actions
  const MAX_RULE_PASSES = 10;
  let pass = 0;
  let converged = true;

  let calcEval = evaluateCalculations(flow.components, currentAnswers);
  errors.push(...calcEval.errors);
  currentAnswers = { ...currentAnswers, ...calcEval.values };

  while (pass < MAX_RULE_PASSES) {
    pass++;
    let stateChanged = false;

    for (const rule of flow.rules) {
      if (!rule.active) continue;
      if (!evaluateRule(rule, currentAnswers)) continue;

      for (const a of rule.actions) {
        if (a.type === "set_value" && a.variable && a.value !== undefined) {
          const prev = currentAnswers[a.variable];
          if (String(prev ?? "") !== String(a.value)) {
            currentAnswers[a.variable] = a.value;
            stateChanged = true;
          }
        }
      }
    }

    if (stateChanged) {
      calcEval = evaluateCalculations(flow.components, currentAnswers);
      errors.push(...calcEval.errors);
      currentAnswers = { ...currentAnswers, ...calcEval.values };
    } else {
      break;
    }
  }

  if (pass >= MAX_RULE_PASSES) {
    converged = false;
    errors.push("Rule evaluation cycle detected: rule actions did not converge after maximum passes.");
  }

  // Phase 2: Final rule action evaluation using converged state
  const matchedRules: Rule[] = [];
  const messages: string[] = [];
  const recommendedIds = new Set<string>();
  const addedProductIds = new Set<string>();
  const addedProductRuleMap = new Map<string, string>();
  const removedProductIds = new Set<string>();
  const ruleHiddenIds = new Set<string>();
  const ruleShownIds = new Set<string>();
  const fees: QuoteLine[] = [];
  let discount = 0;
  let score = 0;

  for (const rule of flow.rules) {
    if (!rule.active) continue;
    if (!evaluateRule(rule, currentAnswers)) continue;
    matchedRules.push(rule);

    for (const a of rule.actions) {
      const product = a.targetKind === "product" ? products.find((p) => p.id === a.targetId) : undefined;
      const pack = a.targetKind === "package" ? packages.find((p) => p.id === a.targetId) : undefined;

      switch (a.type) {
        case "recommend":
          if (product && product.active) {
            recommendedIds.add(product.id);
            messages.push(`Recommend: ${product.name}`);
          } else if (pack && !pack.archived) {
            messages.push(`Recommend: ${pack.name}`);
          }
          break;

        case "add_to_quote":
          if (product && product.active) {
            addedProductIds.add(product.id);
            addedProductRuleMap.set(product.id, rule.id);
            messages.push(`Add to Quote: ${product.name}`);
          }
          break;

        case "remove_from_quote":
          if (product) {
            removedProductIds.add(product.id);
            messages.push(`Removed ${product.name} from quote`);
          }
          break;

        case "add_fee": {
          const feeAmount = Math.max(0, a.amount ?? 0);
          fees.push({
            id: a.id,
            label: a.label || "Fee",
            amount: feeAmount,
            source: "fee",
            sourceRuleId: rule.id,
          });
          messages.push(`${a.label || "Fee"} added ($${feeAmount})`);
          break;
        }

        case "apply_discount": {
          const discountAmount = Math.max(0, a.amount ?? 0);
          discount += discountAmount;
          messages.push(`Discount applied ($${discountAmount})`);
          break;
        }

        case "set_score": {
          const scoreDelta = a.amount ?? 0;
          score += scoreDelta;
          messages.push(`Score ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`);
          break;
        }

        case "set_value":
          if (a.variable) {
            messages.push(`${a.variable} set to ${a.value}`);
          }
          break;

        case "hide":
          if (a.targetId) {
            ruleHiddenIds.add(a.targetId);
            ruleShownIds.delete(a.targetId);
            const compLabel = flow.components.find((c) => c.id === a.targetId)?.label ?? "question";
            messages.push(`Hidden: ${compLabel}`);
          }
          break;

        case "show":
          if (a.targetId) {
            ruleShownIds.add(a.targetId);
            ruleHiddenIds.delete(a.targetId);
            const compLabel = flow.components.find((c) => c.id === a.targetId)?.label ?? "question";
            messages.push(`Shown: ${compLabel}`);
          }
          break;
      }
    }
  }

  // Phase 3: Authoritative Visibility Resolution
  const hiddenComponentIds: string[] = [];
  const allComponents = [...(flow.components ?? []), ...(flow.contactFields ?? [])];

  for (const c of allComponents) {
    if (ruleHiddenIds.has(c.id)) {
      hiddenComponentIds.push(c.id);
    } else if (!ruleShownIds.has(c.id)) {
      if (c.showWhen && isConditionComplete(c.showWhen) && !evaluateCondition(c.showWhen, currentAnswers)) {
        hiddenComponentIds.push(c.id);
      }
    }
  }

  // Phase 4: Line item construction and catalog pricing
  const lines: QuoteLine[] = [];

  // 1. Base Package & Addons
  const basePackage = packages.find((p) => p.id === flow.basePackageId);
  if (basePackage && !basePackage.archived) {
    lines.push({
      id: basePackage.id,
      label: basePackage.name,
      detail: "Base package",
      amount: Math.max(0, basePackage.price),
      source: "package",
      targetId: basePackage.id,
    });
    for (const addon of basePackage.addons) {
      if (selectedAddons.includes(addon.id)) {
        lines.push({
          id: addon.id,
          label: addon.name,
          detail: "Add-on",
          amount: Math.max(0, addon.price),
          source: "addon",
          targetId: addon.id,
        });
      }
    }
  }

  // 2. Calculations with includeInQuote === true
  for (const calc of calcEval.calculations) {
    if (calc.includeInQuote && calc.isReady && calc.value > 0) {
      lines.push({
        id: calc.id,
        label: calc.name,
        detail: "Calculated charge",
        amount: calc.value,
        source: "calculation",
        targetId: calc.id,
      });
    }
  }

  // 3. Rule-added products (add_to_quote), respecting remove_from_quote
  const chargedProductIds = new Set<string>();
  const validRuleAddedProducts = products.filter(
    (p) => p.active && addedProductIds.has(p.id) && !removedProductIds.has(p.id),
  );
  for (const p of validRuleAddedProducts) {
    const ruleId = addedProductRuleMap.get(p.id);
    const line: QuoteLine = {
      id: p.id,
      label: p.name,
      detail: p.description,
      amount: Math.max(0, p.price),
      source: "rule_action",
      targetId: p.id,
    };
    if (ruleId) {
      line.sourceRuleId = ruleId;
    }
    lines.push(line);
    chargedProductIds.add(p.id);
  }

  // 4. Customer explicit selected products (selectedProducts)
  if (selectedProducts && selectedProducts.length > 0) {
    for (const prodId of selectedProducts) {
      if (chargedProductIds.has(prodId)) continue; // prevent duplicate charges
      const p = products.find((prod) => prod.id === prodId && prod.active);
      if (p) {
        lines.push({
          id: p.id,
          label: p.name,
          detail: p.description,
          amount: Math.max(0, p.price),
          source: "customer_selection",
          targetId: p.id,
        });
        chargedProductIds.add(p.id);
      }
    }
  }

  // 5. Fees
  lines.push(...fees);

  // 6. Subtotal, safe discount, and total
  const subtotal = Math.round(lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0) * 100) / 100;
  const safeDiscount = Math.min(subtotal, Math.round(Math.max(0, Number.isFinite(discount) ? discount : 0) * 100) / 100);
  const total = Math.max(0, Math.round((subtotal - safeDiscount) * 100) / 100);

  // Recommendations: products recommended by rules, active, not removed, and not already charged
  const recommendedProducts = products.filter(
    (p) => p.active && recommendedIds.has(p.id) && !removedProductIds.has(p.id) && !chargedProductIds.has(p.id),
  );

  return {
    matchedRules,
    messages,
    recommendedProducts,
    lines,
    subtotal,
    discount: safeDiscount,
    total,
    score,
    hiddenComponentIds,
    calculations: calcEval.calculations.map((c) => ({ name: c.name, variable: c.variable, value: c.value })),
    errors,
    converged,
    resolvedAnswers: currentAnswers,
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
 * Evaluates a single enquiry's quote using the workspace catalog and customer selections.
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
    selectedProducts: enquiry.selectedProducts,
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
