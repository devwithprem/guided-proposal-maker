import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import {
  approveAndIssueProposalAuthoritative,
  deleteFlowAuthoritative,
  deletePackageAuthoritative,
  deleteProductAuthoritative,
  getPublicFlowAuthoritative,
  getPublicProposalByTokenAuthoritative,
  importLegacyWorkspaceAuthoritative,
  resetServerWorkspaceAuthoritative,
  respondToPublicProposalAuthoritative,
  submitCustomerEnquiryAuthoritative,
  updateEnquiryMetaAuthoritative,
  updateEnquiryWorkingQuoteAuthoritative,
  updateSettingsAuthoritative,
  upsertFlowAuthoritative,
  upsertPackageAuthoritative,
  upsertProductAuthoritative,
  type SubmitCustomerEnquiryPayload,
} from "./server/service.server";
import { getServerWorkspaceWithRevision } from "./server/db.server";
import {
  checkLoginRateLimit,
  clearAdminSessionCookie,
  clearLoginRateLimit,
  recordFailedLoginAttempt,
  requireAdminSession,
  setAdminSessionCookie,
  verifyAdminPasscode,
  verifyAdminSessionToken,
  SESSION_COOKIE_NAME,
} from "./server/auth.server";
import type {
  EnquiryQuoteConfig,
  EnquiryStatus,
  Flow,
  Package,
  Product,
  PublicProposalView,
  WorkspaceData,
  WorkspaceSettings,
} from "./types";

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
    let clientIp = "127.0.0.1";
    try {
      const { getRequestIP } = await import("@tanstack/react-start/server");
      clientIp = getRequestIP() || "127.0.0.1";
    } catch {
      // test environment fallback
    }
    const scopeKey = `ip:${clientIp}`;
    const rateLimit = checkLoginRateLimit(scopeKey);
    if (!rateLimit.allowed) {
      const mins = Math.max(1, Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60));
      return {
        success: false,
        error: `Too many failed login attempts. Please try again in ${mins} minute${mins > 1 ? "s" : ""}.`,
        locked: true,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      };
    }

    const valid = verifyAdminPasscode(data.passcode);
    if (!valid) {
      const failed = recordFailedLoginAttempt(scopeKey);
      if (failed.locked) {
        const mins = Math.max(1, Math.ceil((failed.retryAfterSeconds ?? 60) / 60));
        return {
          success: false,
          error: `Too many failed login attempts. Account locked for ${mins} minute${mins > 1 ? "s" : ""}.`,
          locked: true,
          retryAfterSeconds: failed.retryAfterSeconds,
        };
      }
      return { success: false, error: "Incorrect administrator passcode." };
    }

    clearLoginRateLimit(scopeKey);
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
  async (): Promise<{ workspace: WorkspaceData; revision: number }> => {
    requireAdminSession();
    return getServerWorkspaceWithRevision();
  },
);

export const upsertProductServerFn = createServerFn({ method: "POST" })
  .validator((d: { product: Product; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return upsertProductAuthoritative(data.product, "ws_default", data.expectedRevision);
  });

export const deleteProductServerFn = createServerFn({ method: "POST" })
  .validator((d: { productId: string; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return deleteProductAuthoritative(data.productId, "ws_default", data.expectedRevision);
  });

export const upsertPackageServerFn = createServerFn({ method: "POST" })
  .validator((d: { pkg: Package; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return upsertPackageAuthoritative(data.pkg, "ws_default", data.expectedRevision);
  });

export const deletePackageServerFn = createServerFn({ method: "POST" })
  .validator((d: { packageId: string; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return deletePackageAuthoritative(data.packageId, "ws_default", data.expectedRevision);
  });

export const upsertFlowServerFn = createServerFn({ method: "POST" })
  .validator((d: { flow: Flow; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return upsertFlowAuthoritative(data.flow, "ws_default", data.expectedRevision);
  });

export const deleteFlowServerFn = createServerFn({ method: "POST" })
  .validator((d: { flowId: string; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return deleteFlowAuthoritative(data.flowId, "ws_default", data.expectedRevision);
  });

export const updateSettingsServerFn = createServerFn({ method: "POST" })
  .validator((d: { settings: Partial<WorkspaceSettings>; expectedRevision?: number | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return updateSettingsAuthoritative(data.settings, "ws_default", data.expectedRevision);
  });

export const updateEnquiryMetaServerFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      enquiryId: string;
      status?: EnquiryStatus | undefined;
      notes?: string | undefined;
      expectedRevision?: number | undefined;
    }) => d,
  )
  .handler(async ({ data }) => {
    requireAdminSession();
    return updateEnquiryMetaAuthoritative(
      { enquiryId: data.enquiryId, status: data.status, notes: data.notes },
      "ws_default",
      data.expectedRevision,
    );
  });

export const resetServerWorkspaceServerFn = createServerFn({ method: "POST" })
  .validator((d: { confirm: boolean }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    if (!data.confirm) {
      throw new Error("Explicit confirmation required to reset workspace.");
    }
    return resetServerWorkspaceAuthoritative();
  });

export const importLegacyWorkspaceServerFn = createServerFn({ method: "POST" })
  .validator((d: { legacyData: unknown; overrideCatalog?: boolean | undefined }) => d)
  .handler(async ({ data }) => {
    requireAdminSession();
    return importLegacyWorkspaceAuthoritative(data.legacyData, {
      overrideCatalog: data.overrideCatalog,
    });
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
