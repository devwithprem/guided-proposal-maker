import type {
  Enquiry,
  Flow,
  FlowComponent,
  FlowSettings,
  Proposal,
  SubmissionSettings,
  WorkspaceSettings,
} from "./types";

export const CURRENT_SCHEMA_VERSION = 3;

export function defaultContactFields(): FlowComponent[] {
  return [
    { id: "cf_name", type: "text", label: "Full name", variable: "contact_name", variableLocked: true, required: true },
    { id: "cf_email", type: "email", label: "Email address", variable: "contact_email", variableLocked: true, required: true },
    { id: "cf_phone", type: "phone", label: "Phone number", variable: "contact_phone", variableLocked: true, required: false },
    { id: "cf_company", type: "text", label: "Company or event name", variable: "contact_company", variableLocked: true, required: false },
  ];
}

export function defaultFlowSettings(): FlowSettings {
  return {
    headline: "Let's plan your project.",
    subheadline: "Tell us a little about what you need and we'll put together an instant estimate.",
    submitLabel: "Get my quote",
    thankYouMessage: "Thanks — we've received your details. A proposal will land in your inbox shortly.",
    showPriceSummary: true,
    showRecommendations: true,
    breakdown: "itemised",
    accent: "#0f8f78",
    proposalTemplate: "ink",
  };
}

export function defaultSubmissionSettings(): SubmissionSettings {
  return {
    generateProposal: "on_submit",
    delivery: "review",
    notifyEmail: "sales@quoteflow.app",
    webhookUrl: "",
    integrations: ["email"],
  };
}

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    businessName: "Northside Events Co.",
    replyToEmail: "hello@northsideevents.com",
    currency: "USD",
    depositPercent: 25,
    validityDays: 14,
    terms:
      "A 25% non-refundable deposit secures your date. Final balance is due 7 days before the event. Cancellations within 14 days are charged at 50%.",
    autoQuote: true,
    notifyOnSubmit: true,
  };
}

export type FlowDraft = Omit<Flow, "contactFields" | "settings" | "submission"> &
  Partial<Pick<Flow, "contactFields" | "settings" | "submission">>;

/** Lock existing component variables so subsequent label edits do not silently rename them. */
function normalizeComponent(comp: FlowComponent): FlowComponent {
  return {
    ...comp,
    ...(comp.variable ? { variableLocked: comp.variableLocked ?? true } : {}),
  };
}

/** Fills in every field added after the first version of the data model. */
export function withFlowDefaults(flow: FlowDraft): Flow {
  const rawContacts = flow.contactFields?.length ? flow.contactFields : defaultContactFields();
  return {
    ...flow,
    contactFields: rawContacts.map(normalizeComponent),
    components: (flow.components ?? []).map(normalizeComponent),
    rules: flow.rules ?? [],
    settings: { ...defaultFlowSettings(), ...(flow.settings ?? {}) },
    submission: { ...defaultSubmissionSettings(), ...(flow.submission ?? {}) },
  };
}

/** Ensures legacy Enquiry records have safe defaults for new optional fields without losing data. */
export function withEnquiryDefaults(enquiry: Enquiry, flow?: Flow): Enquiry {
  const selectedAddons = Array.isArray(enquiry.selectedAddons) ? enquiry.selectedAddons : [];
  const selectedProducts = Array.isArray(enquiry.selectedProducts) ? enquiry.selectedProducts : [];
  return {
    ...enquiry,
    selectedAddons,
    selectedProducts,
    quoteConfig: enquiry.quoteConfig ?? {
      basePackageId: flow?.basePackageId,
      selectedAddonIds: [...selectedAddons],
      selectedProductIds: [...selectedProducts],
      productQuantities: {},
      manualAdjustments: [],
    },
  };
}

/** Ensures legacy Proposal records preserve their status, revision number, and history arrays. */
export function withProposalDefaults(proposal: Proposal): Proposal {
  return {
    ...proposal,
    revision: proposal.revision ?? 1,
    revisionHistory: Array.isArray(proposal.revisionHistory) ? proposal.revisionHistory : [],
    statusHistory: Array.isArray(proposal.statusHistory) ? proposal.statusHistory : [],
  };
}
