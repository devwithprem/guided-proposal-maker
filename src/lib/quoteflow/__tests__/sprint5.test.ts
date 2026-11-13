import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import {
  closeDb,
  generateSecureProposalToken,
  getDb,
  getServerWorkspace,
  hashPublicToken,
} from "../server/db.server";
import {
  approveAndIssueProposalAuthoritative,
  getPublicFlowAuthoritative,
  getPublicProposalByTokenAuthoritative,
  respondToPublicProposalAuthoritative,
  submitCustomerEnquiryAuthoritative,
  updateEnquiryWorkingQuoteAuthoritative,
} from "../server/service.server";
import {
  createAdminSessionToken,
  verifyAdminPasscode,
  verifyAdminSessionToken,
} from "../server/auth.server";
import { evaluateEnquiryQuote, evaluateWorkingEnquiryQuote } from "../engine";

let currentTestDb: string | null = null;

describe("Sprint 5: Shared Persistence, Server-Authoritative Quotes & Secure Proposals (18 Scenarios)", () => {
  beforeEach(() => {
    closeDb();
    currentTestDb = path.resolve(
      process.cwd(),
      ".data",
      `test_s5_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`,
    );
    process.env["QUOTEFLOW_DB_PATH"] = currentTestDb;
    process.env["QUOTEFLOW_ADMIN_PASSCODE"] = "test-secret-passcode";
    process.env["QUOTEFLOW_SESSION_SECRET"] = "test-session-secret-12345";
    getDb(currentTestDb);
  });

  afterEach(() => {
    closeDb();
    if (currentTestDb && fs.existsSync(currentTestDb)) {
      try {
        fs.unlinkSync(currentTestDb);
      } catch {
        // ignore cleanup error
      }
    }
  });

  // Scenario 1: Authoritative calculations ignore client-tampered pricing
  it("Scenario 1: Submitting an enquiry ignores client-side price tampering and uses authoritative server catalog", () => {
    const res = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Tampering Tester",
        contact_email: "tamper@example.com",
        guest_count: 200,
        event_type: "wedding",
        outdoor: "outdoor",
      },
      selectedProducts: ["p_lighting"],
      productQuantities: { p_lighting: 2 },
    });

    // Authoritative p_lighting price is 650. 2 × 650 = 1300. Base package is 2500. Total = 3800.
    const lightingLine = res.result.lines.find((l) => l.id === "p_lighting");
    expect(lightingLine).toBeDefined();
    expect(lightingLine?.unitPrice).toBe(650);
    expect(lightingLine?.quantity).toBe(2);
    expect(lightingLine?.amount).toBe(1300);
    expect(res.result.total).toBe(3800);
  });

  // Scenario 2: Immutable quoteSnapshot on submission matches engine result
  it("Scenario 2: Enquiry persistence creates an immutable quoteSnapshot matching engine result", () => {
    const res = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Alice Smith",
        contact_email: "alice@example.com",
        guest_count: 100,
      },
    });

    expect(res.enquiry.quoteSnapshot).toBeDefined();
    expect(res.enquiry.quoteSnapshot?.total).toBe(res.result.total);
    expect(res.enquiry.quoteSnapshot?.lines.length).toBe(res.result.lines.length);

    // Verify stored in DB
    const ws = getServerWorkspace();
    const stored = ws.enquiries.find((e) => e.id === res.enquiry.id);
    expect(stored).toBeDefined();
    expect(stored?.quoteSnapshot?.total).toBe(res.result.total);
  });

  // Scenario 3: Flow status guard
  it("Scenario 3: Flow status guard rejects submissions to draft or paused flows", () => {
    const ws = getServerWorkspace();
    const targetFlow = ws.flows.find((f) => f.id === "fl_event_rental")!;
    targetFlow.status = "paused";
    const db = getDb();
    db.prepare("UPDATE workspaces SET data = ? WHERE id = 'ws_default'").run(
      JSON.stringify(ws),
    );

    expect(() =>
      submitCustomerEnquiryAuthoritative({
        flowId: "fl_event_rental",
        answers: { contact_name: "Bob" },
      }),
    ).toThrow(/paused and cannot accept submissions/);
  });

  // Scenario 4: Idempotency prevents duplicates
  it("Scenario 4: Submitting with identical idempotency key returns existing record without duplicating", () => {
    const idempotencyKey = "key_client_req_12345";
    const first = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Idempotent User", contact_email: "idem@example.com" },
      idempotencyKey,
    });

    const second = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Idempotent User", contact_email: "idem@example.com" },
      idempotencyKey,
    });

    expect(second.enquiry.id).toBe(first.enquiry.id);
    const ws = getServerWorkspace();
    const matching = ws.enquiries.filter((e) => e.id === first.enquiry.id);
    expect(matching.length).toBe(1);
  });

  // Scenario 5: Working quote modification preserves original frozen quoteSnapshot
  it("Scenario 5: Business editing working quote updates quoteConfig without altering original quoteSnapshot", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Charlie", contact_email: "charlie@example.com" },
      selectedAddons: ["a_heaters"], // 220
    });

    const originalTotal = submission.enquiry.quoteSnapshot!.total;
    expect(originalTotal).toBe(2720); // 2500 + 220

    // Business modifies working quote: adds dance floor (480) and manual adjustment discount (-200)
    const updated = updateEnquiryWorkingQuoteAuthoritative({
      enquiryId: submission.enquiry.id,
      quoteConfig: {
        basePackageId: "pk_event_rental",
        selectedAddonIds: ["a_heaters", "a_dance"],
        selectedProductIds: [],
        productQuantities: {},
        manualAdjustments: [
          { id: "adj_disc", label: "VIP Discount", amount: 200, quantity: 1, kind: "discount" },
        ],
      },
    });

    // Working total is 2500 + 220 + 480 - 200 = 3000
    expect(updated.workingResult.total).toBe(3000);

    // Stored enquiry quoteSnapshot MUST remain unchanged
    const ws = getServerWorkspace();
    const refreshedEnquiry = ws.enquiries.find((e) => e.id === submission.enquiry.id)!;
    expect(refreshedEnquiry.quoteSnapshot?.total).toBe(originalTotal);
    expect(evaluateEnquiryQuote(refreshedEnquiry, ws)?.total).toBe(originalTotal);
    expect(evaluateWorkingEnquiryQuote(refreshedEnquiry, ws)?.total).toBe(3000);
  });

  // Scenario 6: Proposal approval creates Rev 1 with 256-bit secure token and stores only hash
  it("Scenario 6: Approving proposal generates Rev 1, unguessable token, and stores only its SHA-256 hash", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Diana Prince", contact_email: "diana@example.com" },
    });

    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
      proposalNotes: "Special VIP package for Diana.",
      validityDays: 14,
    });

    expect(issue.proposal.revision).toBe(1);
    expect(issue.proposal.status).toBe("approved");
    expect(issue.rawShareToken).toBeDefined();
    expect(issue.rawShareToken.length).toBe(64); // 32 bytes in hex = 64 characters
    expect(issue.shareUrl).toBe(`/p/${issue.rawShareToken}`);

    // Proposal in workspace has publicTokenHash, NOT raw token
    expect(issue.proposal.publicTokenHash).toBe(hashPublicToken(issue.rawShareToken));
    expect((issue.proposal as any).publicToken).toBeUndefined();
  });

  // Scenario 7: Public token never leaked in plain database queries
  it("Scenario 7: Database workspace never contains the unhashed public token", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Eve", contact_email: "eve@example.com" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });

    const ws = getServerWorkspace();
    const rawWorkspaceJson = JSON.stringify(ws);
    expect(rawWorkspaceJson).not.toContain(issue.rawShareToken);
    expect(rawWorkspaceJson).toContain(issue.proposal.publicTokenHash);
  });

  // Scenario 8: Approving new revision (Rev 2) increments revision and archives Rev 1 in revisionHistory
  it("Scenario 8: Approving a subsequent revision creates Rev 2 and archives previous snapshot", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Frank", contact_email: "frank@example.com" },
    });

    const rev1 = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });
    expect(rev1.proposal.revision).toBe(1);

    // Business changes quote config
    updateEnquiryWorkingQuoteAuthoritative({
      enquiryId: submission.enquiry.id,
      quoteConfig: {
        basePackageId: "pk_event_rental",
        selectedAddonIds: ["a_bar"], // 650
        selectedProductIds: [],
        productQuantities: {},
        manualAdjustments: [],
      },
    });

    const rev2 = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
      proposalNotes: "Rev 2 with Mobile Bar added.",
    });

    expect(rev2.proposal.revision).toBe(2);
    expect(rev2.proposal.revisionHistory?.length).toBe(1);
    expect(rev2.proposal.revisionHistory?.[0]?.revision).toBe(1);
    expect(rev2.proposal.snapshot?.quote.total).toBe(3150); // 2500 + 650
    expect(rev2.rawShareToken).not.toBe(rev1.rawShareToken);
  });

  // Scenario 9: Public proposal lookup by valid token returns sanitized customer view
  it("Scenario 9: Customer proposal view by token returns sanitized view with no internal leakages", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Grace Hopper", contact_email: "grace@navy.mil" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
      proposalNotes: "Official quotation for event rentals.",
    });

    const view = getPublicProposalByTokenAuthoritative(issue.rawShareToken);
    expect(view.proposalId).toBe(issue.proposal.id);
    expect(view.customerName).toBe("Grace Hopper");
    expect(view.customerEmail).toBe("grace@navy.mil");
    expect(view.canRespond).toBe(true);
    expect(view.proposalNotes).toBe("Official quotation for event rentals.");
    expect(view.quote.total).toBe(2500);

    // Assert internal objects are excluded
    expect((view as any).rules).toBeUndefined();
    expect((view as any).publicTokenHash).toBeUndefined();
  });

  // Scenario 10: Public proposal lookup rejects unknown tokens
  it("Scenario 10: Public proposal lookup rejects invalid or unregistered token", () => {
    expect(() => getPublicProposalByTokenAuthoritative("00000000000000000000000000000000")).toThrow(
      /Proposal not found or access link is invalid/,
    );
  });

  // Scenario 11: Public proposal lookup blocks review/draft status
  it("Scenario 11: Public proposal lookup blocks unapproved proposals in review status", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Helen", contact_email: "helen@example.com" },
    });

    // Manually simulate a proposal that has a token but status was reset to 'review'
    const token = generateSecureProposalToken();
    const ws = getServerWorkspace();
    const p = ws.proposals.find((prop) => prop.enquiryId === submission.enquiry.id)!;
    p.publicTokenHash = token.tokenHash;
    p.status = "review";
    const db = getDb();
    db.prepare("UPDATE workspaces SET data = ? WHERE id = 'ws_default'").run(JSON.stringify(ws));

    expect(() => getPublicProposalByTokenAuthoritative(token.rawToken)).toThrow(
      /under review and is not accessible/,
    );
  });

  // Scenario 12: Public proposal lookup rejects expired tokens
  it("Scenario 12: Public proposal lookup rejects expired proposals", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Ian", contact_email: "ian@example.com" },
    });

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
      expiresAt: yesterday,
    });

    expect(() => getPublicProposalByTokenAuthoritative(issue.rawShareToken)).toThrow(
      /proposal link has expired/,
    );
  });

  // Scenario 13: Customer acceptance updates proposal, sets acceptedByName, and updates enquiry to won
  it("Scenario 13: Customer acceptance transitions proposal to accepted, records name, and updates enquiry to won", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Jack", contact_email: "jack@example.com" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });

    const res = respondToPublicProposalAuthoritative({
      rawToken: issue.rawShareToken,
      action: "accept",
      customerName: "Jack Bauer",
    });

    expect(res.status).toBe("accepted");
    expect(res.proposal.acceptedByName).toBe("Jack Bauer");
    expect(res.proposal.respondedAt).toBeDefined();

    // Verify status history
    const lastHistory = res.proposal.statusHistory?.slice(-1)[0];
    expect(lastHistory?.toStatus).toBe("accepted");
    expect(lastHistory?.actor).toBe("customer");

    // Verify enquiry updated to 'won'
    const ws = getServerWorkspace();
    const enquiry = ws.enquiries.find((e) => e.id === submission.enquiry.id)!;
    expect(enquiry.status).toBe("won");
  });

  // Scenario 14: Customer change request requires non-empty note and updates enquiry to qualified
  it("Scenario 14: Customer change request requires non-empty feedback note and updates enquiry to qualified", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Karen", contact_email: "karen@example.com" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });

    expect(() =>
      respondToPublicProposalAuthoritative({
        rawToken: issue.rawShareToken,
        action: "request_changes",
        note: "",
      }),
    ).toThrow(/Please provide details/);

    const res = respondToPublicProposalAuthoritative({
      rawToken: issue.rawShareToken,
      action: "request_changes",
      note: "Can we swap Chiavari chairs for standard folding?",
    });

    expect(res.status).toBe("changes_requested");
    expect(res.proposal.customerResponseNote).toBe(
      "Can we swap Chiavari chairs for standard folding?",
    );

    const ws = getServerWorkspace();
    const enquiry = ws.enquiries.find((e) => e.id === submission.enquiry.id)!;
    expect(enquiry.status).toBe("qualified");
  });

  // Scenario 15: Customer decline updates enquiry to lost
  it("Scenario 15: Customer decline transitions proposal to declined and enquiry to lost", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Leo", contact_email: "leo@example.com" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });

    const res = respondToPublicProposalAuthoritative({
      rawToken: issue.rawShareToken,
      action: "decline",
      note: "Found another vendor.",
    });

    expect(res.status).toBe("declined");
    const ws = getServerWorkspace();
    const enquiry = ws.enquiries.find((e) => e.id === submission.enquiry.id)!;
    expect(enquiry.status).toBe("lost");
  });

  // Scenario 16: Customer cannot respond twice to an already accepted proposal
  it("Scenario 16: Customer cannot respond to a proposal that is already accepted", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Mona", contact_email: "mona@example.com" },
    });
    const issue = approveAndIssueProposalAuthoritative({
      enquiryId: submission.enquiry.id,
    });

    respondToPublicProposalAuthoritative({
      rawToken: issue.rawShareToken,
      action: "accept",
      customerName: "Mona Lisa",
    });

    expect(() =>
      respondToPublicProposalAuthoritative({
        rawToken: issue.rawShareToken,
        action: "decline",
      }),
    ).toThrow(/already been accepted/);
  });

  // Scenario 17: Admin authentication passcode and HMAC session verification
  it("Scenario 17: Admin authentication validates passcode and verifies HMAC session token", () => {
    expect(verifyAdminPasscode("wrong-code")).toBe(false);
    expect(verifyAdminPasscode("test-secret-passcode")).toBe(true);

    const token = createAdminSessionToken();
    expect(verifyAdminSessionToken(token)).toBe(true);
    expect(verifyAdminSessionToken("invalid.token")).toBe(false);
    expect(verifyAdminSessionToken(undefined)).toBe(false);
  });

  // Scenario 18: SQLite persistence survives across database instances
  it("Scenario 18: SQLite persistence retains data across database reconnection", () => {
    const submission = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Nate", contact_email: "nate@example.com" },
    });

    // Close and reopen database
    closeDb();
    const reopenedWs = getServerWorkspace();
    const found = reopenedWs.enquiries.find((e) => e.id === submission.enquiry.id);
    expect(found).toBeDefined();
    expect(found?.customer).toBe("Nate");
  });

  // Scenario 19: Security: Authentication secrets fail closed in production
  it("Scenario 19: Authentication secrets fail closed in production when unset", () => {
    const origEnv = process.env["NODE_ENV"];
    const origSecret = process.env["QUOTEFLOW_SESSION_SECRET"];
    const origPasscode = process.env["QUOTEFLOW_ADMIN_PASSCODE"];

    process.env["NODE_ENV"] = "production";
    delete process.env["QUOTEFLOW_SESSION_SECRET"];
    delete process.env["QUOTEFLOW_ADMIN_PASSCODE"];

    expect(() => createAdminSessionToken()).toThrow(/QUOTEFLOW_SESSION_SECRET.*must be set in production/);
    expect(() => verifyAdminPasscode("any")).toThrow(/QUOTEFLOW_ADMIN_PASSCODE.*must be set in production/);

    process.env["NODE_ENV"] = origEnv;
    if (origSecret !== undefined) process.env["QUOTEFLOW_SESSION_SECRET"] = origSecret;
    if (origPasscode !== undefined) process.env["QUOTEFLOW_ADMIN_PASSCODE"] = origPasscode;
  });

  // Scenario 20: Security: Public flow endpoint never leaks webhookUrl or notifyEmail
  it("Scenario 20: Public flow endpoint strips webhookUrl and notifyEmail from public configuration", () => {
    const res = getPublicFlowAuthoritative("fl_event_rental");

    expect(res.flow).toBeDefined();
    expect(res.flow.submission.webhookUrl).toBe("");
    expect(res.flow.submission.notifyEmail).toBe("");
  });
});
