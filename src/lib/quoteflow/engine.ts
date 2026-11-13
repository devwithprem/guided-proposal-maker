import type {
  Action,
  Calculation,
  Condition,
  Enquiry,
  EnquiryQuoteConfig,
  Flow,
  FlowComponent,
  Operator,
  Package,
  Product,
  Proposal,
  ProposalActorType,
  ProposalSnapshot,
  ProposalStatus,
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

    case "equals": {
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
    }

    case "not_equals": {
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
    }

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
    for (const c of rule.conditions) {
      if (!isConditionComplete(c)) return false;
      if (!evaluateCondition(c, answers)) return false;
    }
    return true;
  }

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

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const calc of calcs) {
    adj.set(calc.id, []);
    inDegree.set(calc.id, 0);
  }

  let hasSelfDependency = false;
  for (const calc of calcs) {
    for (const term of calc.terms) {
      if (term.kind === "variable" && term.variable) {
        const depCalc = calcByResultVar.get(term.variable);
        if (depCalc) {
          if (depCalc.id === calc.id) {
            hasSelfDependency = true;
            inDegree.set(calc.id, (inDegree.get(calc.id) ?? 0) + 1);
          } else {
            adj.get(depCalc.id)?.push(calc.id);
            inDegree.set(calc.id, (inDegree.get(calc.id) ?? 0) + 1);
          }
        }
      }
    }
  }

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

  if (hasSelfDependency || orderedCalcs.length < calcs.length) {
    errors.push("Circular calculation dependency detected among flow calculations");
    for (const calc of calcs) {
      if (!orderedCalcs.some((c) => c.id === calc.id)) {
        orderedCalcs.push(calc);
      }
    }
  }

  const values: Record<string, number> = {};
  const currentAnswers: Answers = { ...answers };
  const computedList: ComputedCalculation[] = [];

  for (const calc of orderedCalcs) {
    let total = 0;
    let isReady = true;

    if (!calc.terms || calc.terms.length === 0) {
      isReady = false;
    }

    calc.terms.forEach((t, i) => {
      let v = 0;
      if (t.kind === "number") {
        if (t.number === undefined || !Number.isFinite(t.number)) {
          errors.push(`Invalid numeric constant in calculation "${calc.name}"`);
          isReady = false;
          v = 0;
        } else {
          v = t.number;
        }
      } else {
        const varKey = t.variable?.trim() ?? "";
        if (!varKey) {
          isReady = false;
          v = 0;
        } else {
          const raw = currentAnswers[varKey];
          if (raw === undefined || raw === null || String(raw).trim() === "") {
            isReady = false;
            v = 0;
          } else {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
              v = parsed;
            } else {
              errors.push(`Non-numeric operand "${String(raw)}" for variable "${varKey}" in calculation "${calc.name}"`);
              isReady = false;
              v = 0;
            }
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
            if (isReady) {
              errors.push(`Divide by zero in calculation "${calc.name}"`);
            }
            isReady = false;
            total = 0;
          } else {
            total = total / v;
          }
          break;
        default:
          total += v;
      }
    });

    if (!Number.isFinite(total)) {
      errors.push(`Non-finite result in calculation "${calc.name}"`);
      isReady = false;
      total = 0;
    }

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

/**
 * Computes which component IDs are hidden given a current answers map.
 */
function resolveHiddenComponentIds(flow: Flow, answers: Answers): string[] {
  const ruleHiddenIds = new Set<string>();
  const ruleShownIds = new Set<string>();

  for (const rule of flow.rules) {
    if (!rule.active) continue;
    if (!evaluateRule(rule, answers)) continue;
    for (const a of rule.actions) {
      if (a.type === "hide" && a.targetId) {
        ruleHiddenIds.add(a.targetId);
        ruleShownIds.delete(a.targetId);
      } else if (a.type === "show" && a.targetId) {
        ruleShownIds.add(a.targetId);
        ruleHiddenIds.delete(a.targetId);
      }
    }
  }

  const hiddenComponentIds: string[] = [];
  const allComponents = [...(flow.components ?? []), ...(flow.contactFields ?? [])];

  for (const c of allComponents) {
    if (ruleHiddenIds.has(c.id)) {
      hiddenComponentIds.push(c.id);
    } else if (!ruleShownIds.has(c.id)) {
      if (c.showWhen && isConditionComplete(c.showWhen) && !evaluateCondition(c.showWhen, answers)) {
        hiddenComponentIds.push(c.id);
      }
    }
  }

  return hiddenComponentIds;
}

/**
 * Strips answers belonging to currently hidden question components so stale draft answers
 * on hidden fields never trigger rules, fees, recommendations, or calculations.
 */
export function getEffectiveAnswers(
  flow: Flow,
  draftAnswers: Answers,
  hiddenComponentIds: readonly string[],
): Answers {
  if (hiddenComponentIds.length === 0) return { ...draftAnswers };
  const hiddenSet = new Set(hiddenComponentIds);
  const allComponents = [...(flow.components ?? []), ...(flow.contactFields ?? [])];

  // Collect variables bound exclusively to hidden question components
  const visibleVars = new Set<string>();
  const hiddenVars = new Set<string>();

  for (const c of allComponents) {
    if (!c.variable || c.type === "calculation" || c.type === "variable") continue;
    if (hiddenSet.has(c.id)) {
      hiddenVars.add(c.variable);
    } else {
      visibleVars.add(c.variable);
    }
  }

  const effective: Answers = { ...draftAnswers };
  for (const v of hiddenVars) {
    if (!visibleVars.has(v)) {
      delete effective[v];
    }
  }
  return effective;
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

export interface RunEngineOptions {
  flow: Flow;
  answers: Answers;
  products: Product[];
  packages: Package[];
  selectedAddons?: string[] | undefined;
  selectedProducts?: string[] | undefined;
  productQuantities?: Record<string, number> | undefined;
  quoteConfig?: EnquiryQuoteConfig | undefined;
  enforceRecommendationEligibility?: boolean | undefined;
}

/**
 * Deterministic business evaluation engine.
 * Supports ALL/ANY rule logic, topological calculations, rule-driven visibility,
 * explicit product selection vs recommendations, quantity multiplication,
 * hidden-answer pruning, and cycle protection for set_value loops.
 */
export function runEngine(opts: RunEngineOptions): EngineResult {
  const {
    flow,
    products,
    packages,
    selectedAddons = [],
    selectedProducts = [],
    productQuantities = {},
    quoteConfig,
    enforceRecommendationEligibility = false,
  } = opts;

  const effectiveSelectedAddons = Array.from(
    new Set([...selectedAddons, ...(quoteConfig?.selectedAddonIds ?? [])]),
  );
  const effectiveSelectedProducts = Array.from(
    new Set([...selectedProducts, ...(quoteConfig?.selectedProductIds ?? [])]),
  );
  const effectiveQuantities: Record<string, number> = {
    ...productQuantities,
    ...(quoteConfig?.productQuantities ?? {}),
  };

  // Seed initial answers + standalone variable defaults
  const baseDraftAnswers: Answers = { ...opts.answers };
  for (const c of flow.components) {
    if (
      c.type === "variable" &&
      c.variable &&
      baseDraftAnswers[c.variable] === undefined &&
      c.defaultValue !== undefined
    ) {
      baseDraftAnswers[c.variable] = c.defaultValue;
    }
  }

  // Resolve initial visibility and prune hidden question answers
  const initialHiddenIds = resolveHiddenComponentIds(flow, baseDraftAnswers);
  let currentAnswers: Answers = getEffectiveAnswers(flow, baseDraftAnswers, initialHiddenIds);

  // Phase 1: Convergence loop for calculations, visibility, and set_value actions
  const MAX_RULE_PASSES = 10;
  let pass = 0;
  let converged = true;
  let stateChanged = false;
  const errorSet = new Set<string>();

  let calcEval = evaluateCalculations(flow.components, currentAnswers);
  calcEval.errors.forEach((e) => errorSet.add(e));
  currentAnswers = { ...currentAnswers, ...calcEval.values };

  while (pass < MAX_RULE_PASSES) {
    pass++;
    stateChanged = false;

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

    // Re-check visibility if variables changed and prune newly hidden answers
    const nextHiddenIds = resolveHiddenComponentIds(flow, currentAnswers);
    const prunedAnswers = getEffectiveAnswers(flow, currentAnswers, nextHiddenIds);
    for (const key of Object.keys(currentAnswers)) {
      if (!(key in prunedAnswers)) {
        delete currentAnswers[key];
        stateChanged = true;
      }
    }

    if (stateChanged) {
      calcEval = evaluateCalculations(flow.components, currentAnswers);
      calcEval.errors.forEach((e) => errorSet.add(e));
      currentAnswers = { ...currentAnswers, ...calcEval.values };
    } else {
      break;
    }
  }

  if (stateChanged) {
    converged = false;
    errorSet.add("Rule evaluation cycle detected: rule actions did not converge after maximum passes.");
  }

  const errors = Array.from(errorSet);

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
          const feeAmount = Math.max(0, Number.isFinite(a.amount) ? (a.amount ?? 0) : 0);
          fees.push({
            id: a.id,
            label: a.label || "Fee",
            amount: Math.round(feeAmount * 100) / 100,
            quantity: 1,
            unitPrice: Math.round(feeAmount * 100) / 100,
            source: "fee",
            sourceRuleId: rule.id,
          });
          messages.push(`${a.label || "Fee"} added ($${feeAmount})`);
          break;
        }

        case "apply_discount": {
          const discountAmount = Math.max(0, Number.isFinite(a.amount) ? (a.amount ?? 0) : 0);
          discount += discountAmount;
          messages.push(`Discount applied ($${discountAmount})`);
          break;
        }

        case "set_score": {
          const scoreDelta = Number.isFinite(a.amount) ? (a.amount ?? 0) : 0;
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
  const effectiveBasePackageId =
    quoteConfig?.basePackageId !== undefined ? quoteConfig.basePackageId : flow.basePackageId;
  const basePackage = packages.find((p) => p.id === effectiveBasePackageId);
  if (basePackage && !basePackage.archived) {
    const pkgPrice = Math.round(Math.max(0, basePackage.price) * 100) / 100;
    lines.push({
      id: basePackage.id,
      label: basePackage.name,
      detail: "Base package",
      amount: pkgPrice,
      quantity: 1,
      unitPrice: pkgPrice,
      source: "package",
      targetId: basePackage.id,
    });
    for (const addon of basePackage.addons) {
      if (effectiveSelectedAddons.includes(addon.id)) {
        const addonPrice = Math.round(Math.max(0, addon.price) * 100) / 100;
        lines.push({
          id: addon.id,
          label: addon.name,
          detail: "Add-on",
          amount: addonPrice,
          quantity: 1,
          unitPrice: addonPrice,
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
        quantity: 1,
        unitPrice: calc.value,
        source: "calculation",
        targetId: calc.id,
      });
    }
  }

  // Helper to resolve safe positive integer quantity for a product
  const resolveProductQuantity = (productId: string): number => {
    const rawQty = effectiveQuantities[productId];
    if (rawQty === undefined) return 1;
    const n = Number(rawQty);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(9999, Math.floor(n));
  };

  // 3. Rule-added products (add_to_quote), respecting remove_from_quote
  const ruleChargedProductIds = new Set<string>();
  const validRuleAddedProducts = products.filter(
    (p) => p.active && addedProductIds.has(p.id) && !removedProductIds.has(p.id),
  );
  for (const p of validRuleAddedProducts) {
    const qty = resolveProductQuantity(p.id) || 1;
    const unitPrice = Math.round(Math.max(0, p.price) * 100) / 100;
    const lineAmount = Math.round(unitPrice * qty * 100) / 100;
    const ruleId = addedProductRuleMap.get(p.id);
    const line: QuoteLine = {
      id: p.id,
      label: p.name,
      detail: qty > 1 ? `${qty} × ${money(unitPrice)} (${p.unit})` : p.description,
      amount: lineAmount,
      quantity: qty,
      unitPrice,
      source: "rule_action",
      targetId: p.id,
    };
    if (ruleId) {
      line.sourceRuleId = ruleId;
    }
    lines.push(line);
    ruleChargedProductIds.add(p.id);
  }

  // 4. Recommendations: products recommended by active matching rules, active, not removed, and not already rule-charged.
  // Keeping customer-selected recommendations in `recommendedProducts` ensures the UI can display their selected state and quantity controls!
  const recommendedProducts = products.filter(
    (p) =>
      p.active &&
      recommendedIds.has(p.id) &&
      !removedProductIds.has(p.id) &&
      !ruleChargedProductIds.has(p.id),
  );

  // 5. Customer explicit selected products (selectedProducts)
  const chargedCustomerProductIds = new Set<string>();
  if (effectiveSelectedProducts.length > 0) {
    for (const prodId of effectiveSelectedProducts) {
      if (ruleChargedProductIds.has(prodId) || chargedCustomerProductIds.has(prodId)) continue;
      if (removedProductIds.has(prodId)) continue;
      if (enforceRecommendationEligibility && !recommendedIds.has(prodId)) continue;

      const p = products.find((prod) => prod.id === prodId && prod.active);
      if (!p) continue;

      const qty = resolveProductQuantity(p.id);
      if (qty <= 0) continue; // Quantity <= 0 means uncharged / removed

      const unitPrice = Math.round(Math.max(0, p.price) * 100) / 100;
      const lineAmount = Math.round(unitPrice * qty * 100) / 100;

      lines.push({
        id: p.id,
        label: p.name,
        detail: qty > 1 ? `${qty} × ${money(unitPrice)} (${p.unit})` : p.description,
        amount: lineAmount,
        quantity: qty,
        unitPrice,
        source: "customer_selection",
        targetId: p.id,
      });
      chargedCustomerProductIds.add(p.id);
    }
  }

  // 6. Fees
  lines.push(...fees);

  // 7. Manual quote adjustments (when configured by business owner)
  if (quoteConfig?.manualAdjustments?.length) {
    for (const adj of quoteConfig.manualAdjustments) {
      const qty = Number.isFinite(adj.quantity) && adj.quantity > 0 ? Math.floor(adj.quantity) : 1;
      const unitPrice = Math.round(Math.max(0, Math.abs(adj.amount)) * 100) / 100;
      const lineAmount = Math.round(unitPrice * qty * 100) / 100;
      if (adj.kind === "discount") {
        discount += lineAmount;
      } else if (lineAmount > 0) {
        lines.push({
          id: adj.id,
          label: adj.label || "Manual adjustment",
          detail: "Manual configuration",
          amount: lineAmount,
          quantity: qty,
          unitPrice,
          source: "business_manual",
          targetId: adj.id,
        });
      }
    }
  }

  // 8. Subtotal, safe discount, and total
  const subtotal =
    Math.round(lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0) * 100) / 100;
  const safeDiscount = Math.min(
    subtotal,
    Math.round(Math.max(0, Number.isFinite(discount) ? discount : 0) * 100) / 100,
  );
  const total = Math.max(0, Math.round((subtotal - safeDiscount) * 100) / 100);

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
    calculations: calcEval.calculations.map((c) => ({
      name: c.name,
      variable: c.variable,
      value: c.value,
    })),
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
  proposalNotes?: string | undefined;
  expiresAt?: string | undefined;
  originalSubmittedTotal?: number | undefined;
}): ProposalSnapshot {
  const { enquiry, flow, result, ws, revision = 1 } = opts;
  const settings = ws.settings ?? defaultWorkspaceSettings();
  const effectiveBasePkgId = enquiry.quoteConfig?.basePackageId !== undefined
    ? enquiry.quoteConfig.basePackageId
    : flow.basePackageId;
  const basePackage = ws.packages.find((p) => p.id === effectiveBasePkgId);
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

  if (opts.originalSubmittedTotal !== undefined) {
    snapshot.originalSubmittedTotal = opts.originalSubmittedTotal;
  } else if (enquiry.quoteSnapshot?.total !== undefined) {
    snapshot.originalSubmittedTotal = enquiry.quoteSnapshot.total;
  }

  if (opts.proposalNotes !== undefined) {
    snapshot.proposalNotes = opts.proposalNotes;
  }

  if (opts.expiresAt !== undefined) {
    snapshot.expiresAt = opts.expiresAt;
  } else {
    const days = Number.isFinite(settings.validityDays) && settings.validityDays > 0 ? settings.validityDays : 14;
    snapshot.expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }

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
 * Evaluates the working proposal quote for an enquiry against current catalog prices,
 * taking into account any business overrides in enquiry.quoteConfig (e.g. package, addons,
 * recommended products, product quantities, manual adjustments).
 * This allows the business owner to modify the proposed quote without touching the frozen enquiry.quoteSnapshot.
 */
export function evaluateWorkingEnquiryQuote(
  enquiry: Enquiry,
  ws: WorkspaceData,
): EngineResult | null {
  const flow = ws.flows.find((f) => f.id === enquiry.flowId);
  if (!flow) return null;

  const quoteConfig = enquiry.quoteConfig;
  return runEngine({
    flow,
    answers: enquiry.answers,
    products: ws.products,
    packages: ws.packages,
    selectedAddons: quoteConfig?.selectedAddonIds ?? enquiry.selectedAddons,
    selectedProducts: quoteConfig?.selectedProductIds ?? enquiry.selectedProducts,
    productQuantities: quoteConfig?.productQuantities,
    quoteConfig,
    enforceRecommendationEligibility: false,
  });
}

/**
 * Validates whether a state transition on a proposal is permitted by the given actor.
 */
export function validateProposalStatusTransition(
  from: ProposalStatus | null,
  to: ProposalStatus,
  actor: ProposalActorType,
): { valid: boolean; error?: string } {
  if (actor === "customer") {
    if (from !== "approved" && from !== "sent") {
      if (from === "accepted") {
        return { valid: false, error: "Proposal has already been accepted." };
      }
      if (from === "changes_requested") {
        return { valid: false, error: "Changes have already been requested; awaiting updated proposal." };
      }
      if (from === "declined") {
        return { valid: false, error: "Proposal has already been declined." };
      }
      return {
        valid: false,
        error: `Customer cannot respond to proposal in status '${from ?? "unknown"}'.`,
      };
    }
    if (to === "accepted" || to === "changes_requested" || to === "declined") {
      return { valid: true };
    }
    return {
      valid: false,
      error: `Customer is not permitted to transition proposal to status '${to}'.`,
    };
  }

  if (actor === "system") {
    return { valid: true };
  }

  // actor === "business"
  if (to === from && to !== "approved") {
    return { valid: false, error: `Proposal is already in status '${to}'.` };
  }
  return { valid: true };
}

/**
 * Evaluates a single enquiry's quote.
 * If the enquiry already has an immutable `quoteSnapshot`, its frozen lines and totals are preserved
 * so subsequent product catalog price changes do not silently mutate historical submitted quotes.
 */
export function evaluateEnquiryQuote(
  enquiry: Enquiry,
  ws: WorkspaceData,
  opts?: { forceLiveRecalculate?: boolean },
): EngineResult | null {
  const flow = ws.flows.find((f) => f.id === enquiry.flowId);
  if (!flow && !enquiry.quoteSnapshot) return null;

  if (enquiry.quoteSnapshot && !opts?.forceLiveRecalculate) {
    const snap = enquiry.quoteSnapshot;
    return {
      matchedRules: flow ? flow.rules.filter((r) => snap.matchedRuleIds.includes(r.id)) : [],
      messages: [],
      recommendedProducts: ws.products.filter((p) => snap.recommendedProductIds.includes(p.id)),
      lines: snap.lines.map((l) => ({ ...l })),
      subtotal: snap.subtotal,
      discount: snap.discount,
      total: snap.total,
      score: snap.score,
      hiddenComponentIds: [],
      calculations: snap.calculations.map((c) => ({ ...c })),
      errors: [],
      converged: true,
      resolvedAnswers: { ...enquiry.answers },
    };
  }

  if (!flow) return null;

  return runEngine({
    flow,
    answers: enquiry.answers,
    products: ws.products,
    packages: ws.packages,
    selectedAddons: enquiry.selectedAddons,
    selectedProducts: enquiry.selectedProducts,
    productQuantities: enquiry.quoteConfig?.productQuantities,
    quoteConfig: enquiry.quoteConfig,
  });
}

/**
 * Returns the authoritative total for an enquiry: reads the immutable quoteSnapshot if present,
 * falling back to live evaluation for legacy unsnapshotted records.
 */
export function getEnquiryTotal(enquiry: Enquiry, ws: WorkspaceData): number {
  if (enquiry.quoteSnapshot) {
    return enquiry.quoteSnapshot.total;
  }
  return evaluateEnquiryQuote(enquiry, ws)?.total ?? 0;
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
  return getEnquiryTotal(enquiry, ws);
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
