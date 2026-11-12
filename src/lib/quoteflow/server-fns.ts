import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import {
  approveAndIssueProposalAuthoritative,
  getPublicFlowAuthoritative,
  getPublicProposalByTokenAuthoritative,
  importLegacyWorkspaceAuthoritative,
  respondToPublicProposalAuthoritative,
  submitCustomerEnquiryAuthoritative,
  updateEnquiryWorkingQuoteAuthoritative,
  type SubmitCustomerEnquiryPayload,
} from "./server/service.server";
import { getServerWorkspace } from "./server/db.server";
import {
  clearAdminSessionCookie,
  requireAdminSession,
  setAdminSessionCookie,
  verifyAdminPasscode,
  verifyAdminSessionToken,
  SESSION_COOKIE_NAME,
} from "./server/auth.server";
import type { EnquiryQuoteConfig, Flow, Package, Product, PublicProposalView, WorkspaceData } from "./types";

// ==========================================
// PUBLIC CUSTOMER ENDPOINTS
// ==========================================

export const getPublicFlowServerFn = createServerFn({ method: "GET" })
  .validator((d: { flowId: string }) => d)
  .handler(async ({ data }): Promise<{
    flow: Flow;
    products: Product[];
    packages: Package[];
  }> => {
    return getPublicFlowAuthoritative(data.flowId);
  });

export const submitCustomerEnquiryServerFn = createServerFn({ method: "POST" })
  .validator((d: SubmitCustomerEnquiryPayload) => d)
  .handler(async ({ data }) => {
    const res = submitCustomerEnquiryAuthoritative(data);
    return {
      success: true,
      enquiryId: res.enquiry.id,
      proposalId: res.proposal?.id ?? null,
      total: res.result.total,
    };
  });

export const getPublicProposalByTokenServerFn = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }): Promise<PublicProposalView> => {
    return getPublicProposalByTokenAuthoritative(data.token);
  });

export const respondToPublicProposalServerFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      token: string;
      action: "accept" | "request_changes" | "decline";
      customerName?: string | undefined;
      note?: string | undefined;
    }) => d,
  )
  .handler(async ({ data }) => {
    const res = respondToPublicProposalAuthoritative({
      rawToken: data.token,
      action: data.action,
      customerName: data.customerName,
      note: data.note,
    });
    return {
      success: true,
      status: res.status,
      proposalId: res.proposal.id,
    };
  });

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

export const getAdminSessionServerFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const cookie = getCookie(SESSION_COOKIE_NAME);
    const authenticated = verifyAdminSessionToken(cookie);
    return { authenticated };
  } catch {
    return { authenticated: false };
  }
});

export const adminLoginServerFn = createServerFn({ method: "POST" })
  .validator((d: { passcode: string }) => d)
  .handler(async ({ data }) => {
    const valid = verifyAdminPasscode(data.passcode);
    if (!valid) {
      return { success: false, error: "Incorrect administrator passcode." };
    }
    const { createAdminSessionToken } = await import("./server/auth.server");
    const token = createAdminSessionToken();
    setAdminSessionCookie(token);
    return { success: true };
  });

export const adminLogoutServerFn = createServerFn({ method: "POST" }).handler(async () => {
  clearAdminSessionCookie();
  return { success: true };
});

// ==========================================
// ADMIN WORKSPACE & REVIEW
// ==========================================

export const getWorkspaceServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceData> => {
    requireAdminSession();
    return getServerWorkspace();
  },
);

export const importLegacyWorkspaceServerFn = createServerFn({ method: "POST" })
  .validator((d: { legacyData: unknown }) => d)
  .handler(async ({ data }): Promise<{ success: boolean; workspace: WorkspaceData }> => {
    requireAdminSession();
    const updated = importLegacyWorkspaceAuthoritative(data.legacyData);
    return { success: true, workspace: updated };
  });

export const saveEnquiryQuoteConfigServerFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      enquiryId: string;
      quoteConfig: EnquiryQuoteConfig;
      notes?: string | undefined;
    }) => d,
  )
  .handler(async ({ data }) => {
    requireAdminSession();
    const res = updateEnquiryWorkingQuoteAuthoritative({
      enquiryId: data.enquiryId,
      quoteConfig: data.quoteConfig,
      notes: data.notes,
    });
    return {
      success: true,
      enquiry: res.enquiry,
      workingTotal: res.workingResult.total,
    };
  });

export const approveAndIssueProposalServerFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      enquiryId: string;
      proposalNotes?: string | undefined;
      expiresAt?: string | undefined;
      validityDays?: number | undefined;
    }) => d,
  )
  .handler(async ({ data }) => {
    requireAdminSession();
    const res = approveAndIssueProposalAuthoritative({
      enquiryId: data.enquiryId,
      proposalNotes: data.proposalNotes,
      expiresAt: data.expiresAt,
      validityDays: data.validityDays,
    });
    return {
      success: true,
      proposal: res.proposal,
      rawShareToken: res.rawShareToken,
      shareUrl: res.shareUrl,
    };
  });
