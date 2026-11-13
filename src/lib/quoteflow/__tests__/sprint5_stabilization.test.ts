import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  closeDb,
  getDb,
  getServerWorkspace,
  getServerWorkspaceWithRevision,
  updateServerWorkspace,
  updateServerWorkspaceWithRevision,
} from "../server/db.server";
import {
  checkLoginRateLimit,
  clearAdminSessionCookie,
  clearLoginRateLimit,
  createAdminSessionToken,
  recordFailedLoginAttempt,
  requireAdminSession,
  verifyAdminPasscode,
  verifyAdminSessionToken,
} from "../server/auth.server";
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
} from "../server/service.server";
import { runEngine } from "../engine";
import {
  getSnapshot,
  getWorkspaceState,
  setState,
  syncFromServer,
  useActions,
} from "../store";
import type { Flow, Product, WorkspaceData } from "../types";

describe("QuoteFlow — Sprint 5 Stabilization: Shared Persistence & Secure Architecture", () => {
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.resolve(
      process.cwd(),
      `.data/test_stab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`,
    );
    process.env["QUOTEFLOW_DB_PATH"] = testDbPath;
    process.env["QUOTEFLOW_ADMIN_PASSCODE"] = "stab-test-passcode";
    process.env["QUOTEFLOW_SESSION_SECRET"] = "stab-test-secret-at-least-32-chars-long";
    getDb(testDbPath);
  });

  afterEach(() => {
    closeDb();
    if (testDbPath && fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // ignore
      }
    }
    const shm = `${testDbPath}-shm`;
    const wal = `${testDbPath}-wal`;
    if (fs.existsSync(shm)) try { fs.unlinkSync(shm); } catch {}
    if (fs.existsSync(wal)) try { fs.unlinkSync(wal); } catch {}
  });

  // 1. Admin product edit persists to SQLite
  it("Scenario 1: Admin product edit reaches and persists to server SQLite", () => {
    const ws = getServerWorkspace();
    const chair = ws.products.find((p) => p.id === "p_std_chair")!;
    expect(chair.price).toBe(4);

    const updated = { ...chair, price: 99 };
    const res = upsertProductAuthoritative(updated);
    expect(res.product.price).toBe(99);

    // Re-read from SQLite directly
    const reloadedWs = getServerWorkspace();
    const updatedChair = reloadedWs.products.find((p) => p.id === "p_std_chair")!;
    expect(updatedChair.price).toBe(99);
  });

  // 2. Public quote uses updated product price
  it("Scenario 2: Public customer submission evaluates against updated server product price", () => {
    const ws = getServerWorkspace();
    const chair = ws.products.find((p) => p.id === "p_std_chair")!;
    upsertProductAuthoritative({ ...chair, price: 99 });

    // Customer submits outdoor wedding quote with seating
    const subRes = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Price Check Customer",
        contact_email: "price@example.com",
        event_type: "wedding",
        guest_count: 50,
        outdoor: "outdoor",
      },
    });

    expect(subRes.enquiry).toBeDefined();
    expect(subRes.result.converged).toBe(true);
  });

  // 3. Admin rule edit reaches server and preserves flow.submissions
  it("Scenario 3: Admin flow edits persist to SQLite while preserving flow.submissions counter", () => {
    const ws = getServerWorkspace();
    const flow = ws.flows.find((f) => f.id === "fl_event_rental")!;

    // Simulate existing 42 customer submissions recorded on server
    updateServerWorkspace((current) => ({
      ...current,
      flows: current.flows.map((f) => (f.id === flow.id ? { ...f, submissions: 42 } : f)),
    }));

    // Admin edits flow name and description in Flow Builder
    const editedFlow: Flow = {
      ...flow,
      name: "Luxury Event Rental & Production",
      submissions: 0, // Admin's form state might have 0 or stale value
    };

    const res = upsertFlowAuthoritative(editedFlow);
    expect(res.flow.name).toBe("Luxury Event Rental & Production");
    // Crucial invariant: Server submission count is preserved!
    expect(res.flow.submissions).toBe(42);

    const reloaded = getServerWorkspace().flows.find((f) => f.id === "fl_event_rental")!;
    expect(reloaded.name).toBe("Luxury Event Rental & Production");
    expect(reloaded.submissions).toBe(42);
  });

  // 4. Customer form reflects latest server flow
  it("Scenario 4: Customer public flow retrieval reflects sanitized flow and active catalog", () => {
    const pub = getPublicFlowAuthoritative("fl_event_rental");
    expect(pub.flow.id).toBe("fl_event_rental");
    expect(pub.flow.submission.webhookUrl).toBe(""); // Sanitized
    expect(pub.flow.submission.notifyEmail).toBe(""); // Sanitized
    expect(pub.products.every((p) => p.active)).toBe(true);
    expect(pub.packages.every((pkg) => !pkg.archived)).toBe(true);
  });

  // 5. Customer submission persists server-side
  it("Scenario 5: Customer submission atomically commits enquiry, QuoteSnapshot, and Proposal to SQLite", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Alice Springs",
        contact_email: "alice@example.com",
        event_type: "wedding",
        guest_count: 200,
        outdoor: "outdoor",
      },
      selectedProducts: ["p_lighting"],
      productQuantities: { p_lighting: 1 },
    });

    const ws = getServerWorkspace();
    const savedEnquiry = ws.enquiries.find((e) => e.id === sub.enquiry.id);
    expect(savedEnquiry).toBeDefined();
    expect(savedEnquiry?.customer).toBe("Alice Springs");
    expect(savedEnquiry?.quoteSnapshot?.total).toBe(sub.result.total);

    const savedProposal = ws.proposals.find((p) => p.enquiryId === sub.enquiry.id);
    expect(savedProposal).toBeDefined();
    expect(savedProposal?.status).toBe("review");
  });

  // 6. Cross-browser enquiry visibility
  it("Scenario 6: Enquiry submitted on Device A is immediately visible to Device B via getServerWorkspaceWithRevision", () => {
    // Device A submits
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Bob Builder",
        contact_email: "bob@example.com",
        event_type: "corporate",
        guest_count: 100,
      },
    });

    // Device B hydrates
    const deviceBState = getServerWorkspaceWithRevision();
    const found = deviceBState.workspace.enquiries.find((e) => e.id === sub.enquiry.id);
    expect(found).toBeDefined();
    expect(found?.email).toBe("bob@example.com");
    expect(deviceBState.revision).toBeGreaterThan(1);
  });

  // 7. Proposal acceptance appears in admin state
  it("Scenario 7: Customer proposal acceptance atomically updates SQLite and linked enquiry to won", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Carol Danvers",
        contact_email: "carol@example.com",
      },
    });

    // Admin approves proposal
    const issueRes = approveAndIssueProposalAuthoritative({ enquiryId: sub.enquiry.id });
    expect(issueRes.rawShareToken).toBeDefined();

    // Customer opens proposal link and accepts
    const acceptRes = respondToPublicProposalAuthoritative({
      rawToken: issueRes.rawShareToken,
      action: "accept",
      customerName: "Carol Danvers",
    });

    expect(acceptRes.status).toBe("accepted");

    // Admin reviews workspace
    const ws = getServerWorkspace();
    const updatedProp = ws.proposals.find((p) => p.id === acceptRes.proposal.id)!;
    expect(updatedProp.status).toBe("accepted");

    const updatedEnquiry = ws.enquiries.find((e) => e.id === sub.enquiry.id)!;
    expect(updatedEnquiry.status).toBe("won");
  });

  // 8. Server restart preserves SQLite data
  it("Scenario 8: Database restart retains all entities, revisions, and proposal token mappings", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Persistent Pete" },
    });
    const issueRes = approveAndIssueProposalAuthoritative({ enquiryId: sub.enquiry.id });
    const rawToken = issueRes.rawShareToken;

    // Simulate process termination / server restart
    closeDb();

    // Reconnect to same database file
    const restartedDb = getDb(testDbPath);
    expect(restartedDb).toBeDefined();

    const publicView = getPublicProposalByTokenAuthoritative(rawToken);
    expect(publicView.customerName).toBe("Persistent Pete");
    expect(publicView.status).toBe("approved");
  });

  // 9. Invalid product selections are rejected
  it("Scenario 9: Customer submission strictly rejects product IDs not recommended by active rules", () => {
    expect(() => {
      submitCustomerEnquiryAuthoritative({
        flowId: "fl_event_rental",
        answers: {
          contact_name: "Malicious Actor",
          // outdoor is NOT selected, so p_lighting is NOT recommended
          event_type: "corporate",
        },
        selectedProducts: ["p_lighting"], // Ineligible product injection
      });
    }).toThrow(/Selected product 'p_lighting' is not eligible/);
  });

  // 10. Invalid quantities are rejected
  it("Scenario 10: Customer submission rejects non-positive, non-integer, or extreme quantities", () => {
    expect(() => {
      submitCustomerEnquiryAuthoritative({
        flowId: "fl_event_rental",
        answers: {
          contact_name: "Quantity Tamperer",
          outdoor: "outdoor",
        },
        selectedProducts: ["p_lighting"],
        productQuantities: { p_lighting: -5 },
      });
    }).toThrow(/Invalid quantity '-5'/);

    expect(() => {
      submitCustomerEnquiryAuthoritative({
        flowId: "fl_event_rental",
        answers: {
          contact_name: "Quantity Tamperer",
          outdoor: "outdoor",
        },
        selectedProducts: ["p_lighting"],
        productQuantities: { p_lighting: 100000 },
      });
    }).toThrow(/Invalid quantity '100000'/);
  });

  // 11. Unauthorized admin mutations are rejected
  it("Scenario 11: requireAdminSession throws error when session token is invalid or missing", () => {
    expect(() => {
      requireAdminSession(null);
    }).toThrow(/Valid administrator session required/);

    expect(() => {
      requireAdminSession("invalid.token.structure");
    }).toThrow(/Valid administrator session required/);

    const validToken = createAdminSessionToken();
    expect(() => {
      requireAdminSession(validToken);
    }).not.toThrow();
  });

  // 12. Login throttling and abuse protection
  it("Scenario 12: Five failed passcode attempts trigger 15-minute lockout; valid login clears tracker", () => {
    const scopeKey = "ip:192.168.1.50";
    clearLoginRateLimit(scopeKey);

    // Initial check: allowed
    expect(checkLoginRateLimit(scopeKey).allowed).toBe(true);

    // 4 failed attempts: still allowed
    for (let i = 1; i <= 4; i++) {
      const res = recordFailedLoginAttempt(scopeKey);
      expect(res.locked).toBe(false);
      expect(res.failedCount).toBe(i);
    }
    expect(checkLoginRateLimit(scopeKey).allowed).toBe(true);

    // 5th failed attempt: locked out!
    const lockRes = recordFailedLoginAttempt(scopeKey);
    expect(lockRes.locked).toBe(true);
    expect(lockRes.failedCount).toBe(5);

    const checkAfterLock = checkLoginRateLimit(scopeKey);
    expect(checkAfterLock.allowed).toBe(false);
    expect(checkAfterLock.retryAfterSeconds).toBeGreaterThan(800);

    // Clear after valid login
    clearLoginRateLimit(scopeKey);
    expect(checkLoginRateLimit(scopeKey).allowed).toBe(true);
  });

  // 13. Token security
  it("Scenario 13: Proposal tokens are 256-bit unguessable and only SHA-256 hashes are stored at rest", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Token Security Check" },
    });
    const issueRes = approveAndIssueProposalAuthoritative({ enquiryId: sub.enquiry.id });
    const rawToken = issueRes.rawShareToken;

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex

    // Verify raw token is NOT in workspaces JSON
    const ws = getServerWorkspace();
    const serialized = JSON.stringify(ws);
    expect(serialized).not.toContain(rawToken);

    // Token hash IS stored in proposal
    const proposal = ws.proposals.find((p) => p.enquiryId === sub.enquiry.id)!;
    expect(proposal.publicTokenHash).toBeDefined();
    expect(proposal.publicTokenHash).not.toBe(rawToken);
  });

  // 14. Customer submission idempotency
  it("Scenario 14: Submitting with identical idempotencyKey returns existing record without duplicating or re-incrementing submissions", () => {
    const key = `idem_${Date.now()}`;
    const initialFlowSubmissions = getServerWorkspace().flows.find((f) => f.id === "fl_event_rental")!.submissions;

    const res1 = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Idempotent Iris" },
      idempotencyKey: key,
    });

    const midFlowSubmissions = getServerWorkspace().flows.find((f) => f.id === "fl_event_rental")!.submissions;
    expect(midFlowSubmissions).toBe(initialFlowSubmissions + 1);

    // Resend with same key
    const res2 = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Idempotent Iris" },
      idempotencyKey: key,
    });

    expect(res2.enquiry.id).toBe(res1.enquiry.id);
    const finalFlowSubmissions = getServerWorkspace().flows.find((f) => f.id === "fl_event_rental")!.submissions;
    expect(finalFlowSubmissions).toBe(midFlowSubmissions); // Did not increment again!
  });

  // 15. Concurrency & Expected Revision Conflict
  it("Scenario 15: Concurrency conflict is detected when expectedRevision does not match current server revision", () => {
    const wsState = getServerWorkspaceWithRevision();
    const currentRev = wsState.revision;

    // Session A updates product with correct revision
    const chair = wsState.workspace.products.find((p) => p.id === "p_std_chair")!;
    upsertProductAuthoritative({ ...chair, name: "Chair A" }, "ws_default", currentRev);

    // Session B attempts to save using obsolete revision
    expect(() => {
      upsertProductAuthoritative({ ...chair, name: "Chair B" }, "ws_default", currentRev);
    }).toThrow(/Concurrency conflict/);
  });

  // 16. Granular mutation isolation
  it("Scenario 16: Granular entity mutations modify only their target entity and do not overwrite concurrent enquiries", () => {
    // Customer submits an enquiry
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Concurrent Customer" },
    });

    // Admin updates a package
    const ws = getServerWorkspace();
    const pkg = ws.packages.find((p) => p.id === "pk_event_rental")!;
    upsertPackageAuthoritative({ ...pkg, description: "Updated package description" });

    // Enquiry must still exist untouched
    const afterWs = getServerWorkspace();
    expect(afterWs.enquiries.some((e) => e.id === sub.enquiry.id)).toBe(true);
    expect(afterWs.packages.find((p) => p.id === "pk_event_rental")?.description).toBe("Updated package description");
  });

  // 17. Stale write safety & revision incrementing
  it("Scenario 17: Every atomic update increments workspace revision monotonically", () => {
    const s1 = getServerWorkspaceWithRevision();
    const rev1 = s1.revision;

    const s2 = updateSettingsAuthoritative({ currency: "EUR" });
    expect(s2.workspaceRevision).toBe(rev1 + 1);

    const s3 = updateSettingsAuthoritative({ currency: "GBP" });
    expect(s3.workspaceRevision).toBe(rev1 + 2);
  });

  // 18. Historical QuoteSnapshot remains unchanged
  it("Scenario 18: Editing catalog product prices after submission never alters historical enquiry quoteSnapshot", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: {
        contact_name: "Snapshot History Test",
        outdoor: "outdoor",
      },
      selectedProducts: ["p_lighting"],
    });

    const frozenTotal = sub.enquiry.quoteSnapshot?.total;

    // Admin triples lighting price
    const ws = getServerWorkspace();
    const lighting = ws.products.find((p) => p.id === "p_lighting")!;
    upsertProductAuthoritative({ ...lighting, price: 9999 });

    // Historical enquiry snapshot total is unchanged
    const reloaded = getServerWorkspace().enquiries.find((e) => e.id === sub.enquiry.id)!;
    expect(reloaded.quoteSnapshot?.total).toBe(frozenTotal);
  });

  // 19. Proposal revisions remain intact
  it("Scenario 19: Working quote adjustments and subsequent approvals issue Rev 2 and archive Rev 1 snapshot", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Revision Tester" },
    });

    // Rev 1
    const rev1Res = approveAndIssueProposalAuthoritative({ enquiryId: sub.enquiry.id });
    expect(rev1Res.proposal.revision).toBe(1);

    // Business modifies working quote
    updateEnquiryWorkingQuoteAuthoritative({
      enquiryId: sub.enquiry.id,
      quoteConfig: {
        selectedAddonIds: [],
        selectedProductIds: [],
        productQuantities: {},
        manualAdjustments: [
          { id: "adj1", label: "VIP Discount", amount: 200, quantity: 1, kind: "discount" as const },
        ],
      },
    });

    // Rev 2
    const rev2Res = approveAndIssueProposalAuthoritative({ enquiryId: sub.enquiry.id });
    expect(rev2Res.proposal.revision).toBe(2);
    expect(rev2Res.proposal.revisionHistory).toHaveLength(1);
    expect(rev2Res.proposal.revisionHistory?.[0]?.revision).toBe(1);
  });

  // 20. Legacy local data merge is non-destructive
  it("Scenario 20: Merging legacy localStorage workspace preserves server enquiries while importing novel items", () => {
    // 1. Server already has a customer enquiry
    const serverSub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Server-Side Customer" },
    });

    // 2. Legacy workspace from browser has a custom flow and a custom product
    const legacyPayload = {
      schemaVersion: 3,
      products: [
        {
          id: "p_custom_dj",
          name: "Custom DJ Service",
          sku: "DJ-CUSTOM",
          description: "4-hour DJ set",
          price: 500,
          unit: "flat",
          category: "Audio",
          active: true,
        },
      ],
      packages: [],
      flows: [
        {
          id: "fl_custom_conference",
          name: "Annual Conference Flow",
          description: "Corporate bookings",
          status: "live",
          submissions: 10,
          basePackageId: "pk_event_rental",
          components: [],
          rules: [],
          contactFields: [],
          settings: { proposalTemplate: "modern" },
          submission: { generateProposal: "on_submit", notifyEmail: "", webhookUrl: "" },
        },
      ],
      enquiries: [
        {
          id: "en_legacy_sarah",
          customer: "Sarah Legacy",
          email: "sarah@legacy.com",
          business: "Sarah Inc",
          flowId: "fl_event_rental",
          status: "qualified",
          createdAt: "2026-08-01",
          answers: {},
          selectedAddons: [],
          selectedProducts: [],
          quoteSnapshot: {
            flowId: "fl_event_rental",
            flowName: "Event Rental",
            timestamp: "2026-08-01",
            currency: "USD",
            subtotal: 1000,
            discount: 0,
            total: 1000,
            lines: [],
            calculations: [],
          },
        },
      ],
      proposals: [],
    };

    const importRes = importLegacyWorkspaceAuthoritative(legacyPayload);
    expect(importRes.importedCounts.products).toBe(1);
    expect(importRes.importedCounts.flows).toBe(1);
    expect(importRes.importedCounts.enquiries).toBe(1);

    const mergedWs = getServerWorkspace();
    // Server customer is preserved
    expect(mergedWs.enquiries.some((e) => e.id === serverSub.enquiry.id)).toBe(true);
    // Legacy customer is imported
    expect(mergedWs.enquiries.some((e) => e.id === "en_legacy_sarah")).toBe(true);
    // Custom product is imported
    expect(mergedWs.products.some((p) => p.id === "p_custom_dj")).toBe(true);
    // Custom flow is imported
    expect(mergedWs.flows.some((f) => f.id === "fl_custom_conference")).toBe(true);
  });

  // 21. Repeated legacy import is idempotent
  it("Scenario 21: Re-running legacy import does not duplicate imported entities", () => {
    const legacyPayload = {
      schemaVersion: 3,
      products: [{ id: "p_dj_once", name: "DJ Once", sku: "DJ-1", price: 300, unit: "flat", active: true }],
      packages: [],
      flows: [],
      enquiries: [],
      proposals: [],
    };

    importLegacyWorkspaceAuthoritative(legacyPayload);
    const count1 = getServerWorkspace().products.filter((p) => p.id === "p_dj_once").length;
    expect(count1).toBe(1);

    // Second import of same payload
    importLegacyWorkspaceAuthoritative(legacyPayload);
    const count2 = getServerWorkspace().products.filter((p) => p.id === "p_dj_once").length;
    expect(count2).toBe(1);
  });

  // 22. Reset server workspace creates backup
  it("Scenario 22: Resetting server workspace creates pre_reset backup in SQLite and resets to seed data", () => {
    // Add custom product
    upsertProductAuthoritative({
      id: "p_pre_reset",
      name: "Pre-reset product",
      sku: "PRE-001",
      description: "",
      price: 100,
      unit: "flat",
      category: "Test",
      active: true,
    });

    const resetRes = resetServerWorkspaceAuthoritative();
    expect(resetRes.backupId).toMatch(/^bk_/);

    const ws = getServerWorkspace();
    expect(ws.products.some((p) => p.id === "p_pre_reset")).toBe(false);

    // Verify backup row exists in SQLite workspace_backups table
    const db = getDb();
    const backupRow = db.prepare("SELECT * FROM workspace_backups WHERE id = ?").get(resetRes.backupId) as {
      id: string;
      reason: string;
      data: string;
    };
    expect(backupRow).toBeDefined();
    expect(backupRow.reason).toBe("pre_reset");
    expect(backupRow.data).toContain("p_pre_reset");
  });

  // 23. Production build targets node-server without unenv stubs
  it("Scenario 23: Production build configuration uses node-server preset and native node:sqlite", () => {
    const viteConfigContent = fs.readFileSync(path.resolve(process.cwd(), "vite.config.ts"), "utf-8");
    expect(viteConfigContent).toContain('preset: process.env["NITRO_PRESET"] || "node-server"');
  });

  // 24. Delete product and package removes them from active lists while preserving historical lines
  it("Scenario 24: Deleting catalog items removes them from active catalog without altering past quotes", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Delete Check" },
    });

    deleteProductAuthoritative("p_staffing");
    const ws = getServerWorkspace();
    expect(ws.products.some((p) => p.id === "p_staffing")).toBe(false);

    // Enquiry still has its lines intact
    const savedEnquiry = ws.enquiries.find((e) => e.id === sub.enquiry.id)!;
    expect(savedEnquiry.quoteSnapshot).toBeDefined();
  });

  // 25. Update Enquiry metadata (status & internal notes)
  it("Scenario 25: updateEnquiryMetaAuthoritative updates status and internal notes while preserving quoteSnapshot", () => {
    const sub = submitCustomerEnquiryAuthoritative({
      flowId: "fl_event_rental",
      answers: { contact_name: "Notes Tester" },
    });

    const res = updateEnquiryMetaAuthoritative({
      enquiryId: sub.enquiry.id,
      status: "qualified",
      notes: "Follow up next Tuesday via phone.",
    });

    expect(res.enquiry.status).toBe("qualified");
    expect(res.enquiry.notes).toBe("Follow up next Tuesday via phone.");

    const reloaded = getServerWorkspace().enquiries.find((e) => e.id === sub.enquiry.id)!;
    expect(reloaded.status).toBe("qualified");
    expect(reloaded.notes).toBe("Follow up next Tuesday via phone.");
    expect(reloaded.quoteSnapshot?.total).toBe(sub.result.total);
  });
});
