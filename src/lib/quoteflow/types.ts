import type { FormDesign, LayoutContainer } from "@devcode-tech/form-builder";
export type { FormDesign, LayoutContainer };

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
  /** True when the user has explicitly customized the variable name or after initial creation */
  variableLocked?: boolean | undefined;
  required?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
  options?: Option[] | undefined;
  /** Default/initial value for standalone variables or prefilled questions */
  defaultValue?: string | number | undefined;
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
  /** When true, adds the calculated amount as a line item to the quote */
  includeInQuote?: boolean | undefined;
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
  containers?: LayoutContainer[] | undefined;
  design?: FormDesign | undefined;
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

/**
 * Canonical origin of a priced or discounted line item.
 * Legacy literals ("package" | "recommended" | "addon" | "fee" | "discount") are retained in the union
 * during transition so existing components compile without breakage.
 */
export type QuoteLineSource =
  | "base_package"
  | "customer_selection"
  | "business_manual"
  | "rule_action"
  | "calculation"
  | "package"
  | "recommended"
  | "addon"
  | "fee"
  | "discount";

export interface QuoteLine {
  id: string;
  label: string;
  detail?: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
  source: QuoteLineSource;
  /** Present when source is "rule_action" (or legacy "fee"/"recommended") */
  sourceRuleId?: string;
  /** Reference to catalog product, package, addon, or calculation ID */
  targetId?: string;
}

export interface ManualQuoteAdjustment {
  id: string;
  label: string;
  amount: number;
  quantity: number;
  kind: "charge" | "discount";
}

export interface EnquiryQuoteConfig {
  basePackageId?: string | undefined;
  selectedAddonIds: string[];
  selectedProductIds: string[];
  productQuantities: Record<string, number>;
  manualAdjustments: ManualQuoteAdjustment[];
}

export interface QuoteSnapshot {
  capturedAt: string;
  flowId: string;
  basePackageId?: string | undefined;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
  score: number;
  matchedRuleIds: string[];
  recommendedProductIds: string[];
  calculations: { name: string; variable: string; value: number }[];
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
  /** Customer-selected recommended product IDs */
  selectedProducts?: string[] | undefined;
  /** Editable working quote configuration for the business owner */
  quoteConfig?: EnquiryQuoteConfig | undefined;
  /** Latest calculated quote snapshot for this enquiry */
  quoteSnapshot?: QuoteSnapshot | undefined;
  notes: string;
}

export type ProposalStatus =
  | "draft"
  | "review"
  | "approved"
  | "sent"
  | "accepted"
  | "changes_requested"
  | "declined";

export type ProposalActorType = "system" | "business" | "customer";

export interface ProposalStatusHistoryEntry {
  id: string;
  proposalId: string;
  fromStatus: ProposalStatus | null;
  toStatus: ProposalStatus;
  actor: ProposalActorType;
  note?: string | undefined;
  timestamp: string;
}

export interface ProposalSnapshot {
  revision: number;
  capturedAt: string;
  customer: string;
  email: string;
  business: string;
  eventDate?: string | undefined;
  location?: string | undefined;
  template: ProposalTemplateId;
  basePackage?: {
    id: string;
    name: string;
    description: string;
    price: number;
    includes: string[];
  } | undefined;
  answers: { variable: string; label: string; value: string }[];
  quote: QuoteSnapshot;
  terms: string;
  validityDays: number;
  depositPercent: number;
  originalSubmittedTotal?: number | undefined;
  proposalNotes?: string | undefined;
  expiresAt?: string | undefined;
}

export interface Proposal {
  id: string;
  enquiryId: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt?: string | undefined;
  title: string;
  /** Immutable snapshot preserved when a proposal is generated or approved */
  snapshot?: ProposalSnapshot | undefined;
  /** Revision number, incremented when creating a new revision of a proposal */
  revision?: number | undefined;
  revisionHistory?: ProposalSnapshot[] | undefined;
  statusHistory?: ProposalStatusHistoryEntry[] | undefined;
  /** SHA-256 hash of the public proposal access token */
  publicTokenHash?: string | undefined;
  publicTokenExpiresAt?: string | undefined;
  customerResponseNote?: string | undefined;
  acceptedByName?: string | undefined;
  respondedAt?: string | undefined;
}

export interface PublicProposalView {
  proposalId: string;
  enquiryId: string;
  status: ProposalStatus;
  revision: number;
  title: string;
  businessName: string;
  customerName: string;
  customerEmail: string;
  eventDate?: string | undefined;
  location?: string | undefined;
  template: ProposalTemplateId;
  terms: string;
  depositPercent: number;
  validityDays: number;
  proposalNotes?: string | undefined;
  expiresAt?: string | undefined;
  quote: QuoteSnapshot;
  respondedAt?: string | undefined;
  customerResponseNote?: string | undefined;
  acceptedByName?: string | undefined;
  canRespond: boolean;
}

export interface WorkspaceSettings {
  businessName: string;
  replyToEmail: string;
  currency: "USD" | "GBP" | "EUR" | "AUD" | "CAD";
  depositPercent: number;
  validityDays: number;
  terms: string;
  autoQuote: boolean;
  notifyOnSubmit: boolean;
}

export interface WorkspaceData {
  schemaVersion?: number | undefined;
  flows: Flow[];
  products: Product[];
  packages: Package[];
  enquiries: Enquiry[];
  proposals: Proposal[];
  proposalStatusHistory?: ProposalStatusHistoryEntry[] | undefined;
  settings?: WorkspaceSettings | undefined;
}
