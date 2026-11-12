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
  generateSecureProposalToken,
  getIdempotencyRecord,
  getServerWorkspace,
  hashPublicToken,
  recordIdempotencyKey,
  recordProposalTokenMapping,
  updateServerWorkspace,
} from "./db.server";
import { defaultWorkspaceSettings } from "../defaults";
import { migrateWorkspaceData, validateWorkspacePayload } from "../migrations";
import type {
  Enquiry,
  EnquiryQuoteConfig,
  Proposal,
  ProposalSnapshot,
  ProposalStatus,
  PublicProposalView,
  WorkspaceData,
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

  // 3. Server-side quote evaluation
  const engineResult = runEngine({
    flow,
    answers,
    products: initialWs.products,
    packages: initialWs.packages,
    selectedAddons,
    selectedProducts,
    productQuantities,
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
 * Migrates and imports a legacy localStorage workspace into the authoritative server SQLite store.
 */
export function importLegacyWorkspaceAuthoritative(
  legacyData: unknown,
  workspaceId = "ws_default",
): WorkspaceData {
  const validation = validateWorkspacePayload(legacyData);
  if (!validation.valid) {
    throw new Error(`Invalid legacy workspace payload: ${validation.reason}`);
  }

  const migrated = migrateWorkspaceData(legacyData);

  return updateServerWorkspace(() => migrated, workspaceId);
}
