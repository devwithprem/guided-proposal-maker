import type { Flow, FlowComponent, FlowSettings, SubmissionSettings } from "./types";

export function defaultContactFields(): FlowComponent[] {
  return [
    { id: "cf_name", type: "text", label: "Full name", variable: "contact_name", required: true },
    { id: "cf_email", type: "email", label: "Email address", variable: "contact_email", required: true },
    { id: "cf_phone", type: "phone", label: "Phone number", variable: "contact_phone", required: false },
    { id: "cf_company", type: "text", label: "Company or event name", variable: "contact_company", required: false },
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

export type FlowDraft = Omit<Flow, "contactFields" | "settings" | "submission"> &
  Partial<Pick<Flow, "contactFields" | "settings" | "submission">>;

/** Fills in every field added after the first version of the data model. */
export function withFlowDefaults(flow: FlowDraft): Flow {
  return {
    ...flow,
    contactFields: flow.contactFields?.length ? flow.contactFields : defaultContactFields(),
    settings: { ...defaultFlowSettings(), ...(flow.settings ?? {}) },
    submission: { ...defaultSubmissionSettings(), ...(flow.submission ?? {}) },
  };
}
