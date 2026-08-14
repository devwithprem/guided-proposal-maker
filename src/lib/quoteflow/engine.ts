import type { Action, Calculation, Condition, Flow, Operator, Package, Product, Rule } from "./types";

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

export interface QuoteLine {
  id: string;
  label: string;
  detail?: string;
  amount: number;
  source: "package" | "recommended" | "addon" | "fee" | "discount";
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
          fees.push({ id: a.id, label: a.label || "Fee", amount: a.amount ?? 0, source: "fee" });
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

  const recommendedProducts = products.filter((p) => recommendedIds.has(p.id) && !removedIds.has(p.id));

  const lines: QuoteLine[] = [];
  const basePackage = packages.find((p) => p.id === flow.basePackageId);
  if (basePackage) {
    lines.push({ id: basePackage.id, label: basePackage.name, detail: "Base package", amount: basePackage.price, source: "package" });
    for (const addon of basePackage.addons) {
      if (selectedAddons.includes(addon.id)) {
        lines.push({ id: addon.id, label: addon.name, detail: "Add-on", amount: addon.price, source: "addon" });
      }
    }
  }
  for (const p of recommendedProducts) {
    lines.push({ id: p.id, label: p.name, detail: p.description, amount: p.price, source: "recommended" });
  }
  lines.push(...fees);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = Math.max(0, subtotal - discount);

  return { matchedRules, messages, recommendedProducts, lines, subtotal, discount, total, score, hiddenComponentIds, calculations };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function slugToVariable(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function flowVariables(flow: Flow) {
  const vars: { variable: string; label: string; options?: { label: string; value: string }[]; type: string }[] = [];
  for (const c of flow.components) {
    if (c.variable) vars.push({ variable: c.variable, label: c.label, options: c.options, type: c.type });
    if (c.type === "calculation" && c.calculation)
      vars.push({ variable: c.calculation.resultVariable, label: c.calculation.name, type: "calculation" });
  }
  return vars;
}