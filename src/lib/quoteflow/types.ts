export type QuestionType =
  | "text"
  | "number"
  | "email"
  | "phone"
  | "dropdown"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "date"
  | "file";

export type BusinessType =
  | "variable"
  | "product-selector"
  | "package-selector"
  | "recommendation"
  | "calculation"
  | "score";

export type OutputType = "price-summary" | "proposal" | "crm-action";

export type ComponentType = QuestionType | BusinessType | OutputType;

export interface Option {
  id: string;
  label: string;
  value: string;
}

export interface FlowComponent {
  id: string;
  type: ComponentType;
  label: string;
  description?: string;
  variable?: string;
  required?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  options?: Option[];
  /** for calculation components */
  calculation?: Calculation;
}

export type Operator =
  | "equals"
  | "not_equals"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "contains"
  | "is_empty"
  | "is_not_empty";

export interface Condition {
  id: string;
  variable: string;
  operator: Operator;
  value: string;
}

export type ActionType =
  | "show"
  | "hide"
  | "recommend"
  | "add_to_quote"
  | "remove_from_quote"
  | "set_value"
  | "add_fee"
  | "apply_discount"
  | "set_score";

export interface Action {
  id: string;
  type: ActionType;
  /** product | package | question */
  targetKind?: "product" | "package" | "question";
  targetId?: string;
  label?: string;
  amount?: number;
  variable?: string;
  value?: string;
}

export interface Rule {
  id: string;
  name: string;
  match: "all" | "any";
  conditions: Condition[];
  actions: Action[];
  active: boolean;
}

export type CalcOperator = "+" | "-" | "×" | "÷";

export interface CalcTerm {
  id: string;
  /** variable name or a literal number */
  kind: "variable" | "number";
  variable?: string;
  number?: number;
  operator?: CalcOperator; // operator joining this term to the previous one
}

export interface Calculation {
  id: string;
  name: string;
  resultVariable: string;
  terms: CalcTerm[];
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  status: "live" | "draft" | "paused";
  submissions: number;
  updatedAt: string;
  components: FlowComponent[];
  rules: Rule[];
  basePackageId?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  unit: string;
  category: string;
  active: boolean;
}

export interface Package {
  id: string;
  name: string;
  description: string;
  price: number;
  includes: string[];
  addons: { id: string; name: string; price: number }[];
  archived: boolean;
}

export type EnquiryStatus = "new" | "qualified" | "quoted" | "won" | "lost";

export interface Enquiry {
  id: string;
  customer: string;
  email: string;
  business: string;
  flowId: string;
  status: EnquiryStatus;
  createdAt: string;
  eventDate?: string;
  location?: string;
  answers: Record<string, string | number | string[]>;
  selectedAddons: string[];
  notes: string;
}

export interface Proposal {
  id: string;
  enquiryId: string;
  status: "draft" | "sent" | "accepted";
  createdAt: string;
  title: string;
}

export interface WorkspaceData {
  flows: Flow[];
  products: Product[];
  packages: Package[];
  enquiries: Enquiry[];
  proposals: Proposal[];
}