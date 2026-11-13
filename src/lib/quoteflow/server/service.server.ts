import {
  createProposalSnapshot,
  createQuoteSnapshot,
  evaluateEnquiryQuote,
  evaluateWorkingEnquiryQuote,
  runEngine,
  validateProposalStatusTransition,
  type EngineResult,
} from "../engine";
import {
  backupWorkspace,
  generateSecureProposalToken,
  getIdempotencyRecord,
  getServerWorkspace,
  getServerWorkspaceWithRevision,
  hashPublicToken,
  recordIdempotencyKey,
  recordProposalTokenMapping,
  updateServerWorkspace,
  updateServerWorkspaceWithRevision,
} from "./db.server";
import { defaultWorkspaceSettings } from "../defaults";
import { migrateWorkspaceData, validateWorkspacePayload } from "../migrations";
import { seedData } from "../seed";
import type {
  Enquiry,
  EnquiryQuoteConfig,
  EnquiryStatus,
  Flow,
  Package,
  Product,
  Proposal,
  ProposalSnapshot,
  ProposalStatus,
  PublicProposalView,
  WorkspaceData,
  WorkspaceSettings,
} from "../types";

export interface SubmitCustomerEnquiryPayload {
  flowId: string;
  answers: Record<string, string | number | string[]>;
  selectedAddons?: string[] | undefined;
  selectedProducts?: string[] | undefined;
  productQuantities?: Record<string, number> | undefined;
  idempotencyKey?: string | undefined;
}

export interface SubmitCustomerEnquiryResult {
  enquiry: Enquiry;
  proposal: Proposal | null;
  result: EngineResult;
}

/**
 * Public flow retrieval for embed widget.
 * Validates flow is live and strips sensitive submission settings (webhookUrl, notifyEmail)
 * so private webhook tokens and recipient emails never leak to public customer browsers.
 */
export function getPublicFlowAuthoritative(
  flowId: string,
  workspaceId = "ws_default",
): {
  flow: Flow;
  products: WorkspaceData["products"];
  packages: WorkspaceData["packages"];
} {
  const ws = getServerWorkspace(workspaceId);
  const flow = ws.flows.find((f) => f.id === flowId);
  if (!flow) {
    throw new Error(`Flow '${flowId}' not found.`);
  }
  if (flow.status !== "live") {
    throw new Error(`Flow '${flow.name}' is currently ${flow.status} and unavailable.`);
  }
  const sanitizedFlow: Flow = {
    ...flow,
    submission: {
      ...flow.submission,
      notifyEmail: "",
      webhookUrl: "",
    },
  };
  return {
    flow: sanitizedFlow,
    products: ws.products.filter((p) => p.active),
    packages: ws.packages.filter((pkg) => !pkg.archived),
  };
}

/**
 * Server-authoritative enquiry submission.
 * Validates flow, ignores client price tampering, deterministically evaluates quote,
 * creates immutable snapshot, and persists enquiry and proposal atomically.
 */
export function submitCustomerEnquiryAuthoritative(
  payload: SubmitCustomerEnquiryPayload,
  workspaceId = "ws_default",
): SubmitCustomerEnquiryResult {
  const { flowId, answers, selectedAddons = [], selectedProducts = [], productQuantities = {}, idempotencyKey } = payload;

  // 1. Idempotency Check
  if (idempotencyKey && idempotencyKey.trim().length > 0) {
    const existingKeyRecord = getIdempotencyRecord(idempotencyKey.trim());
    if (existingKeyRecord) {
      const ws = getServerWorkspace(workspaceId);
      const existingEnquiry = ws.enquiries.find((e) => e.id === existingKeyRecord.enquiry_id);
      if (existingEnquiry) {
        const existingProposal = existingKeyRecord.proposal_id
          ? ws.proposals.find((p) => p.id === existingKeyRecord.proposal_id) ?? null
          : ws.proposals.find((p) => p.enquiryId === existingEnquiry.id) ?? null;

        const evaluated = evaluateEnquiryQuote(existingEnquiry, ws);
        if (evaluated) {
          return {
            enquiry: existingEnquiry,
            proposal: existingProposal,
            result: evaluated,
          };
        }
      }
    }
  }

  // 2. Load workspace and validate flow
  const initialWs = getServerWorkspace(workspaceId);
  const flow = initialWs.flows.find((f) => f.id === flowId);
  if (!flow) {
    throw new Error(`Flow '${flowId}' was not found.`);
  }
  if (flow.status !== "live") {
    throw new Error(`Flow '${flow.name}' is currently ${flow.status} and cannot accept submissions.`);
  }

  // 3. Selection Eligibility Discovery & Strict Validation
  const prelimResult = runEngine({
    flow,
    answers,
    products: initialWs.products,
    packages: initialWs.packages,
    selectedAddons: [],
    selectedProducts: [],
    productQuantities: {},
  });

  const eligibleRecommendedProductIds = new Set(prelimResult.recommendedProducts.map((p) => p.id));
  const basePackage = initialWs.packages.find((p) => p.id === flow.basePackageId);
  const eligibleAddonIds = new Set(basePackage?.addons.map((a) => a.id) ?? []);

  // Reject unauthorized/ineligible products
  for (const prodId of selectedProducts) {
    if (!eligibleRecommendedProductIds.has(prodId)) {
      throw new Error(`Selected product '${prodId}' is not eligible for this quotation.`);
    }
  }

  // Reject unauthorized/ineligible add-ons
  for (const addonId of selectedAddons) {
    if (!eligibleAddonIds.has(addonId)) {
      throw new Error(`Selected add-on '${addonId}' is not eligible for base package.`);
    }
  }

  // Validate quantities: must be finite integers in 1..9999
  const ruleAddedProductIds = new Set(
    prelimResult.lines.filter((l) => l.source === "rule_action").map((l) => l.targetId || l.id),
  );
  for (const [prodId, qty] of Object.entries(productQuantities)) {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      throw new Error(
        `Invalid quantity '${qty}' for product '${prodId}'. Must be an integer between 1 and 9999.`,
      );
    }
    if (!eligibleRecommendedProductIds.has(prodId) && !ruleAddedProductIds.has(prodId)) {
      throw new Error(`Quantity specified for unrecommended/ineligible product '${prodId}'.`);
    }
  }

  // 4. Server-side quote evaluation with recommendation enforcement
  const engineResult = runEngine({
    flow,
    answers,
    products: initialWs.products,
    packages: initialWs.packages,
    selectedAddons,
    selectedProducts,
    productQuantities,
    enforceRecommendationEligibility: true,
  });

  if (!engineResult.converged) {
    throw new Error("Unable to calculate authoritative quote: engine failed to converge.");
  }
  if (engineResult.errors.length > 0) {
    throw new Error(`Quote calculation validation error: ${engineResult.errors.join("; ")}`);
  }

  // 4. Construct immutable QuoteSnapshot
  const quoteSnapshot = createQuoteSnapshot(flow, engineResult);

  // 5. Build Enquiry
  const now = new Date().toISOString();
  const enquiryId = `en_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const customerName = String(answers["contact_name"] ?? answers["name"] ?? "Customer").trim();
  const customerEmail = String(answers["contact_email"] ?? answers["email"] ?? "").trim();
  const customerBusiness = String(answers["contact_company"] ?? answers["company"] ?? "").trim();

  const newEnquiry: Enquiry = {
    id: enquiryId,
    customer: customerName || "Customer",
    email: customerEmail,
    business: customerBusiness,
    flowId: flow.id,
    status: "new",
    createdAt: now,
    answers: { ...answers },
    selectedAddons: [...selectedAddons],
    selectedProducts: [...selectedProducts],
    quoteConfig: {
      basePackageId: flow.basePackageId,
      selectedAddonIds: [...selectedAddons],
      selectedProductIds: [...selectedProducts],
      productQuantities: { ...productQuantities },
      manualAdjustments: [],
    },
    quoteSnapshot,
    notes: "",
  };

  if (answers["event_date"]) newEnquiry.eventDate = String(answers["event_date"]);
  if (answers["event_location"]) newEnquiry.location = String(answers["event_location"]);

  // 6. Build Proposal if configured on_submit
  let newProposal: Proposal | null = null;
  const generateProposal = flow.submission?.generateProposal ?? "on_submit";

  if (generateProposal === "on_submit") {
    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const proposalSnapshot = createProposalSnapshot({
      enquiry: newEnquiry,
      flow,
      result: engineResult,
      ws: initialWs,
      revision: 1,
      originalSubmittedTotal: quoteSnapshot.total,
    });

    const status: ProposalStatus = "review";
    newProposal = {
      id: proposalId,
      enquiryId,
      status,
      createdAt: now,
      updatedAt: now,
      title: `${flow.name} — ${newEnquiry.customer || "Enquiry"}`,
      revision: 1,
      snapshot: proposalSnapshot,
      revisionHistory: [],
      statusHistory: [
        {
          id: `sh_${Date.now()}_1`,
          proposalId,
          fromStatus: null,
          toStatus: status,
          actor: "system",
          note: "Enquiry submitted by customer. Queued for business review.",
          timestamp: now,
        },
      ],
    };
  }

  // 7. Atomic SQLite persistence
  updateServerWorkspace(
    (current) => {
      const targetFlow = current.flows.find((f) => f.id === flowId);
      if (targetFlow) {
        targetFlow.submissions = (targetFlow.submissions || 0) + 1;
        targetFlow.updatedAt = now;
      }
      return {
        ...current,
        enquiries: [newEnquiry, ...current.enquiries],
        proposals: newProposal ? [newProposal, ...current.proposals] : current.proposals,
        proposalStatusHistory: newProposal?.statusHistory
          ? [...(current.proposalStatusHistory ?? []), ...newProposal.statusHistory]
          : current.proposalStatusHistory,
      };
    },
    workspaceId,
  );

  // 8. Record Idempotency Key
  if (idempotencyKey && idempotencyKey.trim().length > 0) {
    recordIdempotencyKey(idempotencyKey.trim(), enquiryId, newProposal?.id);
  }

  return {
    enquiry: newEnquiry,
    proposal: newProposal,
    result: engineResult,
  };
}

/**
 * Updates the business owner's working quote configuration for an enquiry
 * without touching the frozen enquiry.quoteSnapshot.
 */
export function updateEnquiryWorkingQuoteAuthoritative(
  opts: {
    enquiryId: string;
    quoteConfig: EnquiryQuoteConfig;
    notes?: string | undefined;
  },
  workspaceId = "ws_default",
): { enquiry: Enquiry; workingResult: EngineResult } {
  let updatedEnquiry: Enquiry | null = null;
  let evaluatedWorkingResult: EngineResult | null = null;

  updateServerWorkspace(
    (current) => {
      const enquiryIndex = current.enquiries.findIndex((e) => e.id === opts.enquiryId);
      if (enquiryIndex === -1) {
        throw new Error(`Enquiry '${opts.enquiryId}' not found.`);
      }

      const existing = current.enquiries[enquiryIndex];
      if (!existing) {
        throw new Error(`Enquiry '${opts.enquiryId}' not found.`);
      }

      const modified: Enquiry = {
        ...existing,
        quoteConfig: { ...opts.quoteConfig },
        notes: opts.notes !== undefined ? opts.notes : existing.notes,
      };

      const result = evaluateWorkingEnquiryQuote(modified, current);
      if (!result) {
        throw new Error(`Unable to evaluate working quote for enquiry '${opts.enquiryId}'.`);
      }

      updatedEnquiry = modified;
      evaluatedWorkingResult = result;

      const newEnquiries = [...current.enquiries];
      newEnquiries[enquiryIndex] = modified;

      return {
        ...current,
        enquiries: newEnquiries,
      };
    },
    workspaceId,
  );

  if (!updatedEnquiry || !evaluatedWorkingResult) {
    throw new Error("Failed to update working quote.");
  }

  return {
    enquiry: updatedEnquiry,
    workingResult: evaluatedWorkingResult,
  };
}

/**
 * Business action: approves working quote, increments revision, generates 256-bit secure token,
 * stores SHA-256 hash in database, and returns shareable customer link.
 */
export function approveAndIssueProposalAuthoritative(
  opts: {
    enquiryId: string;
    proposalNotes?: string | undefined;
    expiresAt?: string | undefined;
    validityDays?: number | undefined;
  },
  workspaceId = "ws_default",
): { proposal: Proposal; rawShareToken: string; shareUrl: string } {
  const { rawToken, tokenHash } = generateSecureProposalToken();
  const now = new Date().toISOString();
  let resultProposal: Proposal | null = null;

  updateServerWorkspace(
    (current) => {
      const enquiry = current.enquiries.find((e) => e.id === opts.enquiryId);
      if (!enquiry) {
        throw new Error(`Enquiry '${opts.enquiryId}' not found.`);
      }
      const flow = current.flows.find((f) => f.id === enquiry.flowId);
      if (!flow) {
        throw new Error(`Flow '${enquiry.flowId}' not found for enquiry '${enquiry.id}'.`);
      }

      const proposal = current.proposals.find((p) => p.enquiryId === enquiry.id);
      const isNewProposal = !proposal;
      const hasBeenIssued = Boolean(proposal?.publicTokenHash);
      const nextRev = hasBeenIssued ? (proposal?.revision ?? 1) + 1 : (proposal?.revision ?? 1);

      // Evaluate the latest working quote
      const workingResult = evaluateWorkingEnquiryQuote(enquiry, current) ?? evaluateEnquiryQuote(enquiry, current);
      if (!workingResult) {
        throw new Error("Could not evaluate quote for proposal generation.");
      }

      const settings = current.settings ?? defaultWorkspaceSettings();
      const valDays = opts.validityDays ?? settings.validityDays ?? 14;
      const calculatedExpiresAt =
        opts.expiresAt || new Date(Date.now() + valDays * 86400000).toISOString();

      const newSnapshot: ProposalSnapshot = createProposalSnapshot({
        enquiry,
        flow,
        result: workingResult,
        ws: current,
        revision: nextRev,
        proposalNotes: opts.proposalNotes,
        expiresAt: calculatedExpiresAt,
        originalSubmittedTotal: enquiry.quoteSnapshot?.total ?? workingResult.total,
      });

      const previousStatus = proposal?.status ?? null;
      const transitionValidation = validateProposalStatusTransition(previousStatus, "approved", "business");
      if (!transitionValidation.valid) {
        throw new Error(transitionValidation.error ?? "Invalid status transition.");
      }

      const historyEntry = {
        id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        proposalId: proposal?.id ?? `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fromStatus: previousStatus,
        toStatus: "approved" as ProposalStatus,
        actor: "business" as const,
        note: `Proposal Rev ${nextRev} approved and issued by business.`,
        timestamp: now,
      };

      const revisionHistory = hasBeenIssued && proposal?.snapshot
        ? [...(proposal.revisionHistory ?? []), proposal.snapshot]
        : proposal?.revisionHistory ?? [];

      const updatedProposal: Proposal = {
        id: proposal?.id ?? historyEntry.proposalId,
        enquiryId: enquiry.id,
        status: "approved",
        createdAt: proposal?.createdAt ?? now,
        updatedAt: now,
        title: `${flow.name} — ${enquiry.customer || "Enquiry"}`,
        revision: nextRev,
        snapshot: newSnapshot,
        revisionHistory,
        statusHistory: [...(proposal?.statusHistory ?? []), historyEntry],
        publicTokenHash: tokenHash,
        publicTokenExpiresAt: calculatedExpiresAt,
      };

      resultProposal = updatedProposal;

      // Update enquiry status to 'quoted' if previously new
      const updatedEnquiries = current.enquiries.map((e) => {
        if (e.id === enquiry.id && (e.status === "new" || e.status === "qualified")) {
          return { ...e, status: "quoted" as const };
        }
        return e;
      });

      const updatedProposals = isNewProposal
        ? [updatedProposal, ...current.proposals]
        : current.proposals.map((p) => (p.id === updatedProposal.id ? updatedProposal : p));

      // Record token mapping in SQLite table
      recordProposalTokenMapping({
        tokenHash,
        proposalId: updatedProposal.id,
        enquiryId: enquiry.id,
        revision: nextRev,
        expiresAt: calculatedExpiresAt,
      });

      return {
        ...current,
        enquiries: updatedEnquiries,
        proposals: updatedProposals,
        proposalStatusHistory: [...(current.proposalStatusHistory ?? []), historyEntry],
      };
    },
    workspaceId,
  );

  if (!resultProposal) {
    throw new Error("Failed to approve and issue proposal.");
  }

  return {
    proposal: resultProposal,
    rawShareToken: rawToken,
    shareUrl: `/p/${rawToken}`,
  };
}

/**
 * Public customer read endpoint.
 * Validates raw token hash against SQLite records, blocks draft/review status,
 * verifies expiration, and returns sanitized customer-facing proposal data.
 */
export function getPublicProposalByTokenAuthoritative(
  rawToken: string,
  workspaceId = "ws_default",
): PublicProposalView {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    throw new Error("Invalid proposal token.");
  }

  const tokenHash = hashPublicToken(rawToken);
  const ws = getServerWorkspace(workspaceId);

  // Look for matching proposal with this token hash
  const proposal = ws.proposals.find((p) => p.publicTokenHash === tokenHash);
  if (!proposal || !proposal.snapshot) {
    throw new Error("Proposal not found or access link is invalid.");
  }

  // Check review/draft status gate
  if (proposal.status === "draft" || proposal.status === "review") {
    throw new Error("Proposal is currently under review and is not accessible.");
  }

  // Check expiration date
  if (proposal.publicTokenExpiresAt) {
    const exp = new Date(proposal.publicTokenExpiresAt).getTime();
    if (Date.now() > exp) {
      throw new Error("This proposal link has expired. Please contact the business for an updated quote.");
    }
  }

  const snap = proposal.snapshot;
  const enquiry = ws.enquiries.find((e) => e.id === proposal.enquiryId);
  const flow = enquiry ? ws.flows.find((f) => f.id === enquiry.flowId) : undefined;
  const settings = ws.settings ?? defaultWorkspaceSettings();

  const canRespond = proposal.status === "approved" || proposal.status === "sent";

  return {
    proposalId: proposal.id,
    enquiryId: proposal.enquiryId,
    status: proposal.status,
    revision: proposal.revision ?? snap.revision ?? 1,
    title: proposal.title || `${snap.business} Proposal`,
    businessName: settings.businessName || snap.business,
    customerName: snap.customer,
    customerEmail: snap.email,
    eventDate: snap.eventDate,
    location: snap.location,
    template: snap.template || flow?.settings.proposalTemplate || "ink",
    terms: snap.terms || settings.terms,
    depositPercent: snap.depositPercent ?? settings.depositPercent,
    validityDays: snap.validityDays ?? settings.validityDays,
    proposalNotes: snap.proposalNotes,
    expiresAt: snap.expiresAt ?? proposal.publicTokenExpiresAt,
    quote: snap.quote,
    respondedAt: proposal.respondedAt,
    customerResponseNote: proposal.customerResponseNote,
    acceptedByName: proposal.acceptedByName,
    canRespond,
  };
}

/**
 * Customer action endpoint: accept, request changes, or decline.
 * Verifies raw token hash, validates status transition, updates proposal and enquiry,
 * and records status history entry.
 */
export function respondToPublicProposalAuthoritative(
  opts: {
    rawToken: string;
    action: "accept" | "request_changes" | "decline";
    customerName?: string | undefined;
    note?: string | undefined;
  },
  workspaceId = "ws_default",
): { proposal: Proposal; status: ProposalStatus } {
  const { rawToken, action, customerName, note } = opts;
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Invalid proposal token.");
  }

  const tokenHash = hashPublicToken(rawToken);
  const now = new Date().toISOString();

  let targetStatus: ProposalStatus;
  if (action === "accept") {
    if (!customerName || customerName.trim().length === 0) {
      throw new Error("Please enter your name to confirm proposal acceptance.");
    }
    targetStatus = "accepted";
  } else if (action === "request_changes") {
    if (!note || note.trim().length === 0) {
      throw new Error("Please provide details regarding the changes you are requesting.");
    }
    targetStatus = "changes_requested";
  } else if (action === "decline") {
    targetStatus = "declined";
  } else {
    throw new Error(`Unsupported action '${action}'.`);
  }

  let finalProposal: Proposal | null = null;

  updateServerWorkspace(
    (current) => {
      const proposalIndex = current.proposals.findIndex((p) => p.publicTokenHash === tokenHash);
      if (proposalIndex === -1) {
        throw new Error("Proposal not found or access link is invalid.");
      }

      const proposal = current.proposals[proposalIndex];
      if (!proposal) {
        throw new Error("Proposal not found or access link is invalid.");
      }

      // Validate customer transition
      const transition = validateProposalStatusTransition(proposal.status, targetStatus, "customer");
      if (!transition.valid) {
        throw new Error(transition.error ?? "Invalid status transition.");
      }

      // Check token expiry
      if (proposal.publicTokenExpiresAt) {
        const exp = new Date(proposal.publicTokenExpiresAt).getTime();
        if (Date.now() > exp) {
          throw new Error("This proposal link has expired and can no longer be accepted.");
        }
      }

      const historyEntry = {
        id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        proposalId: proposal.id,
        fromStatus: proposal.status,
        toStatus: targetStatus,
        actor: "customer" as const,
        note:
          action === "accept"
            ? `Accepted by ${customerName!.trim()}`
            : action === "request_changes"
              ? `Changes requested: ${note!.trim()}`
              : `Declined by customer${note ? `: ${note.trim()}` : ""}`,
        timestamp: now,
      };

      const updatedProposal: Proposal = {
        ...proposal,
        status: targetStatus,
        respondedAt: now,
        updatedAt: now,
        ...(action === "accept" && customerName ? { acceptedByName: customerName.trim() } : {}),
        ...(note ? { customerResponseNote: note.trim() } : {}),
        statusHistory: [...(proposal.statusHistory ?? []), historyEntry],
      };

      finalProposal = updatedProposal;

      // Update associated Enquiry status
      const updatedEnquiries = current.enquiries.map((e) => {
        if (e.id === proposal.enquiryId) {
          if (targetStatus === "accepted") return { ...e, status: "won" as const };
          if (targetStatus === "declined") return { ...e, status: "lost" as const };
          if (targetStatus === "changes_requested") return { ...e, status: "qualified" as const };
        }
        return e;
      });

      const updatedProposals = [...current.proposals];
      updatedProposals[proposalIndex] = updatedProposal;

      return {
        ...current,
        enquiries: updatedEnquiries,
        proposals: updatedProposals,
        proposalStatusHistory: [...(current.proposalStatusHistory ?? []), historyEntry],
      };
    },
    workspaceId,
  );

  if (!finalProposal) {
    throw new Error("Failed to process proposal response.");
  }

  return {
    proposal: finalProposal,
    status: targetStatus,
  };
}

/**
 * Granular Admin Mutation Service Functions
 */

export function upsertProductAuthoritative(
  product: Product,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { product: Product; workspaceRevision: number } {
  if (!product.id || typeof product.id !== "string") {
    throw new Error("Product ID is required.");
  }
  const name = (product.name || "").trim();
  if (!name) {
    throw new Error("Product name cannot be empty.");
  }
  if (!Number.isFinite(product.price) || product.price < 0) {
    throw new Error("Product price must be a finite non-negative number.");
  }

  const sanitizedProduct: Product = {
    ...product,
    name,
    sku: (product.sku || "").trim(),
    description: (product.description || "").trim(),
    price: Math.round(product.price * 100) / 100,
    active: Boolean(product.active),
  };

  const res = updateServerWorkspaceWithRevision(
    (current) => {
      const exists = current.products.some((p) => p.id === sanitizedProduct.id);
      const nextProducts = exists
        ? current.products.map((p) => (p.id === sanitizedProduct.id ? sanitizedProduct : p))
        : [sanitizedProduct, ...current.products];
      return {
        ...current,
        products: nextProducts,
      };
    },
    workspaceId,
    undefined,
    expectedRevision,
  );

  return { product: sanitizedProduct, workspaceRevision: res.revision };
}

export function deleteProductAuthoritative(
  productId: string,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { success: boolean; workspaceRevision: number } {
  if (!productId || typeof productId !== "string") {
    throw new Error("Product ID is required.");
  }
  const res = updateServerWorkspaceWithRevision(
    (current) => ({
      ...current,
      products: current.products.filter((p) => p.id !== productId),
    }),
    workspaceId,
    undefined,
    expectedRevision,
  );
  return { success: true, workspaceRevision: res.revision };
}

export function upsertPackageAuthoritative(
  pkg: Package,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { package: Package; workspaceRevision: number } {
  if (!pkg.id || typeof pkg.id !== "string") {
    throw new Error("Package ID is required.");
  }
  const name = (pkg.name || "").trim();
  if (!name) {
    throw new Error("Package name cannot be empty.");
  }
  if (!Number.isFinite(pkg.price) || pkg.price < 0) {
    throw new Error("Package price must be a finite non-negative number.");
  }

  const sanitizedPackage: Package = {
    ...pkg,
    name,
    description: (pkg.description || "").trim(),
    price: Math.round(pkg.price * 100) / 100,
    includes: Array.isArray(pkg.includes) ? pkg.includes.map((i) => String(i).trim()) : [],
    addons: Array.isArray(pkg.addons)
      ? pkg.addons.map((a) => ({
          ...a,
          name: (a.name || "").trim(),
          price: Math.round(Math.max(0, Number(a.price) || 0) * 100) / 100,
        }))
      : [],
    archived: Boolean(pkg.archived),
  };

  const res = updateServerWorkspaceWithRevision(
    (current) => {
      const exists = current.packages.some((p) => p.id === sanitizedPackage.id);
      const nextPackages = exists
        ? current.packages.map((p) => (p.id === sanitizedPackage.id ? sanitizedPackage : p))
        : [sanitizedPackage, ...current.packages];
      return {
        ...current,
        packages: nextPackages,
      };
    },
    workspaceId,
    undefined,
    expectedRevision,
  );

  return { package: sanitizedPackage, workspaceRevision: res.revision };
}

export function deletePackageAuthoritative(
  packageId: string,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { success: boolean; workspaceRevision: number } {
  if (!packageId || typeof packageId !== "string") {
    throw new Error("Package ID is required.");
  }
  const res = updateServerWorkspaceWithRevision(
    (current) => ({
      ...current,
      packages: current.packages.filter((p) => p.id !== packageId),
    }),
    workspaceId,
    undefined,
    expectedRevision,
  );
  return { success: true, workspaceRevision: res.revision };
}

export function upsertFlowAuthoritative(
  flow: Flow,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { flow: Flow; workspaceRevision: number } {
  if (!flow.id || typeof flow.id !== "string") {
    throw new Error("Flow ID is required.");
  }
  const name = (flow.name || "").trim();
  if (!name) {
    throw new Error("Flow name cannot be empty.");
  }

  let updatedFlowResult: Flow = flow;

  const res = updateServerWorkspaceWithRevision(
    (current) => {
      const existing = current.flows.find((f) => f.id === flow.id);
      // Invariant: Server preserves the flow.submissions counter so admin edits don't reset customer analytics!
      const serverSubmissions = existing?.submissions ?? flow.submissions ?? 0;
      const now = new Date().toISOString().slice(0, 10);

      const mergedFlow: Flow = {
        ...flow,
        name,
        submissions: serverSubmissions,
        updatedAt: now,
      };
      updatedFlowResult = mergedFlow;

      const nextFlows = existing
        ? current.flows.map((f) => (f.id === flow.id ? mergedFlow : f))
        : [mergedFlow, ...current.flows];

      return {
        ...current,
        flows: nextFlows,
      };
    },
    workspaceId,
    undefined,
    expectedRevision,
  );

  return { flow: updatedFlowResult, workspaceRevision: res.revision };
}

export function deleteFlowAuthoritative(
  flowId: string,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { success: boolean; workspaceRevision: number } {
  if (!flowId || typeof flowId !== "string") {
    throw new Error("Flow ID is required.");
  }
  const res = updateServerWorkspaceWithRevision(
    (current) => ({
      ...current,
      flows: current.flows.filter((f) => f.id !== flowId),
    }),
    workspaceId,
    undefined,
    expectedRevision,
  );
  return { success: true, workspaceRevision: res.revision };
}

export function updateSettingsAuthoritative(
  patch: Partial<WorkspaceSettings>,
  workspaceId = "ws_default",
  expectedRevision?: number,
): { settings: WorkspaceSettings; workspaceRevision: number } {
  let updatedSettings: WorkspaceSettings = defaultWorkspaceSettings();
  const res = updateServerWorkspaceWithRevision(
    (current) => {
      updatedSettings = {
        ...defaultWorkspaceSettings(),
        ...(current.settings ?? {}),
        ...patch,
      };
      return {
        ...current,
        settings: updatedSettings,
      };
    },
    workspaceId,
    undefined,
    expectedRevision,
  );
  return { settings: updatedSettings, workspaceRevision: res.revision };
}

export function updateEnquiryMetaAuthoritative(
  params: { enquiryId: string; status?: EnquiryStatus | undefined; notes?: string | undefined },
  workspaceId = "ws_default",
  expectedRevision?: number | undefined,
): { enquiry: Enquiry; workspaceRevision: number } {
  let targetEnquiry: Enquiry | undefined;
  const res = updateServerWorkspaceWithRevision(
    (current) => {
      const existing = current.enquiries.find((e) => e.id === params.enquiryId);
      if (!existing) {
        throw new Error(`Enquiry '${params.enquiryId}' not found.`);
      }
      const updated: Enquiry = {
        ...existing,
        status: params.status ?? existing.status,
        notes: params.notes !== undefined ? params.notes : existing.notes,
      };
      targetEnquiry = updated;
      return {
        ...current,
        enquiries: current.enquiries.map((e) => (e.id === params.enquiryId ? updated : e)),
      };
    },
    workspaceId,
    undefined,
    expectedRevision,
  );
  if (!targetEnquiry) {
    throw new Error(`Enquiry '${params.enquiryId}' not found.`);
  }
  return { enquiry: targetEnquiry, workspaceRevision: res.revision };
}

export function resetServerWorkspaceAuthoritative(
  workspaceId = "ws_default",
): { workspace: WorkspaceData; backupId: string; workspaceRevision: number } {
  const backupId = backupWorkspace("pre_reset", workspaceId);
  const fresh = migrateWorkspaceData(seedData());
  const res = updateServerWorkspaceWithRevision(() => fresh, workspaceId);
  return { workspace: fresh, backupId, workspaceRevision: res.revision };
}

/**
 * Non-destructively migrates and imports a legacy localStorage workspace into the authoritative server SQLite store.
 * Backs up existing server workspace before merge. Server strictly wins on existing enquiry and proposal records.
 */
export function importLegacyWorkspaceAuthoritative(
  legacyData: unknown,
  options?: { overrideCatalog?: boolean | undefined } | undefined,
  workspaceId = "ws_default",
): {
  workspace: WorkspaceData;
  backupId: string;
  workspaceRevision: number;
  importedCounts: { flows: number; products: number; packages: number; enquiries: number };
} {
  const validation = validateWorkspacePayload(legacyData);
  if (!validation.valid) {
    throw new Error(`Invalid legacy workspace payload: ${validation.reason}`);
  }

  const legacy = migrateWorkspaceData(legacyData);
  const backupId = backupWorkspace("pre_legacy_import", workspaceId);

  const counts = { flows: 0, products: 0, packages: 0, enquiries: 0 };
  const overrideCatalog = Boolean(options?.overrideCatalog);

  const res = updateServerWorkspaceWithRevision(
    (current) => {
      // 1. Enquiries: Server strictly wins on existing enquiry IDs!
      const serverEnquiryIds = new Set(current.enquiries.map((e) => e.id));
      const newEnquiries = legacy.enquiries.filter((e) => !serverEnquiryIds.has(e.id));
      counts.enquiries = newEnquiries.length;
      const mergedEnquiries = [...current.enquiries, ...newEnquiries];

      // 2. Proposals: Server strictly wins on existing proposal IDs!
      const serverProposalIds = new Set(current.proposals.map((p) => p.id));
      const newProposals = legacy.proposals.filter((p) => !serverProposalIds.has(p.id));
      const mergedProposals = [...current.proposals, ...newProposals];

      // 3. Status History
      const serverStatusHistoryIds = new Set((current.proposalStatusHistory ?? []).map((h) => h.id));
      const newStatusHistory = (legacy.proposalStatusHistory ?? []).filter(
        (h) => !serverStatusHistoryIds.has(h.id),
      );
      const mergedStatusHistory = [...(current.proposalStatusHistory ?? []), ...newStatusHistory];

      // 4. Products
      const serverProductMap = new Map(current.products.map((p) => [p.id, p]));
      const finalProducts = [...current.products];
      for (const lp of legacy.products) {
        const existing = serverProductMap.get(lp.id);
        if (!existing) {
          finalProducts.push(lp);
          counts.products++;
        } else if (overrideCatalog) {
          const idx = finalProducts.findIndex((p) => p.id === lp.id);
          if (idx !== -1) finalProducts[idx] = lp;
        }
      }

      // 5. Packages
      const serverPackageMap = new Map(current.packages.map((p) => [p.id, p]));
      const finalPackages = [...current.packages];
      for (const lpk of legacy.packages) {
        const existing = serverPackageMap.get(lpk.id);
        if (!existing) {
          finalPackages.push(lpk);
          counts.packages++;
        } else if (overrideCatalog) {
          const idx = finalPackages.findIndex((p) => p.id === lpk.id);
          if (idx !== -1) finalPackages[idx] = lpk;
        }
      }

      // 6. Flows: Preserve server-side flow.submissions!
      const serverFlowMap = new Map(current.flows.map((f) => [f.id, f]));
      const finalFlows = [...current.flows];
      for (const lf of legacy.flows) {
        const existing = serverFlowMap.get(lf.id);
        if (!existing) {
          finalFlows.push(lf);
          counts.flows++;
        } else if (overrideCatalog) {
          const idx = finalFlows.findIndex((f) => f.id === lf.id);
          if (idx !== -1) {
            finalFlows[idx] = {
              ...lf,
              submissions: existing.submissions, // Invariant: retain server submission count
            };
          }
        }
      }

      // 7. Settings
      const mergedSettings = {
        ...defaultWorkspaceSettings(),
        ...(current.settings ?? {}),
        ...(legacy.settings ?? {}),
      };

      return {
        ...current,
        products: finalProducts,
        packages: finalPackages,
        flows: finalFlows,
        enquiries: mergedEnquiries,
        proposals: mergedProposals,
        proposalStatusHistory: mergedStatusHistory,
        settings: mergedSettings,
      };
    },
    workspaceId,
  );

  return {
    workspace: res.workspace,
    backupId,
    workspaceRevision: res.revision,
    importedCounts: counts,
  };
}
