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
  description?: string | undefined;
  variable?: string | undefined;
  required?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
  options?: Option[] | undefined;
  /** for calculation components */
  calculation?: Calculation | undefined;
  /** only show this question when the condition passes */
  showWhen?: Condition | undefined;
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
  targetKind?: "product" | "package" | "question" | undefined;
  targetId?: string | undefined;
  label?: string | undefined;
  amount?: number | undefined;
  variable?: string | undefined;
  value?: string | undefined;
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
  variable?: string | undefined;
  number?: number | undefined;
  operator?: CalcOperator | undefined; // operator joining this term to the previous one
}

export interface Calculation {
  id: string;
  name: string;
  resultVariable: string;
  terms: CalcTerm[];
}

export type ProposalTemplateId = "ink" | "minimal" | "editorial" | "compact";

export interface FlowSettings {
  headline: string;
  subheadline: string;
  submitLabel: string;
  thankYouMessage: string;
  showPriceSummary: boolean;
  showRecommendations: boolean;
  breakdown: "itemised" | "total";
  accent: string;
  proposalTemplate: ProposalTemplateId;
}

export interface SubmissionSettings {
  generateProposal: "never" | "on_submit";
  delivery: "immediate" | "review";
  notifyEmail: string;
  webhookUrl: string;
  integrations: string[];
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  status: "live" | "draft" | "paused";
  submissions: number;
  updatedAt: string;
  /** step 1 — basic contact details */
  contactFields: FlowComponent[];
  components: FlowComponent[];
  rules: Rule[];
  basePackageId?: string | undefined;
  settings: FlowSettings;
  submission: SubmissionSettings;
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
  eventDate?: string | undefined;
  location?: string | undefined;
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