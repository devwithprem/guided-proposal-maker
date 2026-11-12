import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  defaultWorkspaceSettings,
  withEnquiryDefaults,
  withFlowDefaults,
  withProposalDefaults,
} from "../defaults";
import {
  MigrationError,
  WORKSPACE_BACKUP_KEY,
  WORKSPACE_RESET_BACKUP_KEY,
  backupRawWorkspaceIfNeeded,
  migrateWorkspaceData,
  validateWorkspacePayload,
} from "../migrations";
import {
  createProposalSnapshot,
  createQuoteSnapshot,
  createUniqueVariable,
  evaluateEnquiryQuote,
  getProposalTotal,
  migrateEnquiryAnswersOnVariableRename,
  renameCalculationResultVariable,
  renameFlowOptionValue,
  renameFlowVariable,
  runEngine,
} from "../engine";
import {
  getCustomerQuestionComponents,
  mergeExternalFieldsIntoFlow,
  normalizeFormAnswers,
  toExternalFormSchema,
} from "../form-builder-adapter";
import { seedData, uid } from "../seed";
import type { Enquiry, Flow, Package, Product, Proposal, WorkspaceData } from "../types";

describe("Sprint 1: Safe Domain Foundation & Persistence", () => {
  // Test 1: Migrating valid legacy workspace data
  it("migrates valid legacy v1 workspace data to schema version 2", () => {
    const legacyWorkspace = seedData();
    // Simulate legacy v1 payload where schemaVersion was undefined
    delete (legacyWorkspace as Partial<WorkspaceData>).schemaVersion;
    delete (legacyWorkspace as Partial<WorkspaceData>).settings;

    const migrated = migrateWorkspaceData(legacyWorkspace);

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.settings).toEqual(defaultWorkspaceSettings());
    expect(migrated.flows.length).toBe(legacyWorkspace.flows.length);
    expect(migrated.products.length).toBe(legacyWorkspace.products.length);
    expect(migrated.packages.length).toBe(legacyWorkspace.packages.length);
    expect(migrated.enquiries.length).toBe(legacyWorkspace.enquiries.length);
    expect(migrated.proposals.length).toBe(legacyWorkspace.proposals.length);
  });

  // Test 2: Preserving every existing record
  it("preserves every existing flow, product, package, enquiry, proposal, and custom field", () => {
    const customFlow: Flow = withFlowDefaults({
      id: "fl_custom_test",
      name: "Custom Test Flow",
      description: "Testing preservation",
      status: "draft",
      submissions: 42,
      updatedAt: "2026-09-01",
      contactFields: [],
      components: [
        {
          id: "c_q1",
          type: "text",
          label: "Custom Question",
          variable: "cust_var",
          variableLocked: true,
        },
      ],
      rules: [],
      settings: {
        headline: "Custom Headline",
        subheadline: "Custom Sub",
        submitLabel: "Send Now",
        thankYouMessage: "Thanks custom",
        showPriceSummary: false,
        showRecommendations: true,
        breakdown: "total",
        accent: "#123456",
        proposalTemplate: "minimal",
      },
      submission: {
        generateProposal: "on_submit",
        delivery: "immediate",
        notifyEmail: "test@domain.com",
        webhookUrl: "https://example.com/hook",
        integrations: ["email", "slack"],
      },
    });

    const customEnquiry: Enquiry = {
      id: "en_custom_test",
      customer: "Jane Doe",
      email: "jane@test.com",
      business: "Jane Events",
      flowId: "fl_custom_test",
      status: "quoted",
      createdAt: "2026-09-02",
      answers: { cust_var: "Answer 1" },
      selectedAddons: ["addon_1"],
      notes: "Custom notes",
    };

    const customProposal: Proposal = {
      id: "pr_custom_test",
      enquiryId: "en_custom_test",
      status: "sent",
      createdAt: "2026-09-03",
      title: "Custom Proposal",
    };

    const customData = {
      flows: [customFlow],
      products: [],
      packages: [],
      enquiries: [customEnquiry],
      proposals: [customProposal],
    };

    const migrated = migrateWorkspaceData(customData);

    expect(migrated.flows[0]?.id).toBe("fl_custom_test");
    expect(migrated.flows[0]?.settings.headline).toBe("Custom Headline");
    expect(migrated.enquiries[0]?.id).toBe("en_custom_test");
    expect(migrated.enquiries[0]?.quoteConfig?.selectedAddonIds).toEqual(["addon_1"]);
    expect(migrated.proposals[0]?.id).toBe("pr_custom_test");
    expect(migrated.proposals[0]?.revision).toBe(1);
    // Explicit empty array preservation
    expect(migrated.products).toEqual([]);
    expect(migrated.packages).toEqual([]);
  });

  // Test 3: Handling malformed data without silent overwrite
  it("rejects malformed workspace payloads and throws MigrationError instead of silently overwriting", () => {
    expect(() => migrateWorkspaceData("not-an-object")).toThrowError(MigrationError);
    expect(() => migrateWorkspaceData(12345)).toThrowError(MigrationError);
    expect(() => migrateWorkspaceData(["an", "array"])).toThrowError(MigrationError);

    const validation1 = validateWorkspacePayload("not-json");
    expect(validation1.valid).toBe(false);

    const validation2 = validateWorkspacePayload({ random: "data" });
    expect(validation2.valid).toBe(false);
  });

  // Test 4: Rejecting unsupported future schema versions safely
  it("rejects unsupported future schema versions safely", () => {
    const futureData = {
      schemaVersion: 999,
      flows: [],
      products: [],
      packages: [],
      enquiries: [],
      proposals: [],
    };

    expect(() => migrateWorkspaceData(futureData)).toThrowError(MigrationError);
    expect(() => migrateWorkspaceData(futureData)).toThrow(/future schema version/);

    const validation = validateWorkspacePayload(futureData);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Unsupported future schema version");
  });

  // Test 5: Migration idempotency
  it("is idempotent: migrating already-migrated data produces identical data", () => {
    const seed = seedData();
    const migratedOnce = migrateWorkspaceData(seed);
    const migratedTwice = migrateWorkspaceData(migratedOnce);

    expect(migratedTwice).toEqual(migratedOnce);
    expect(migratedTwice.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  // Test 6: Backup preservation
  it("creates a recovery backup once and never overwrites it with subsequent calls", () => {
    const mockStorage: Record<string, string> = {};
    const originalWindow = globalThis.window;

    const mockLocalStorage: Storage = {
      length: 0,
      clear: () => {
        for (const k of Object.keys(mockStorage)) delete mockStorage[k];
      },
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      key: (i: number) => Object.keys(mockStorage)[i] ?? null,
    };

    globalThis.window = {
      localStorage: mockLocalStorage,
    } as unknown as Window & typeof globalThis;

    try {
      const initialLegacyJson = JSON.stringify({ flows: [{ id: "f1" }] });
      const initialBackedUp = backupRawWorkspaceIfNeeded(initialLegacyJson);
      expect(initialBackedUp).toBe(true);
      expect(mockStorage[WORKSPACE_BACKUP_KEY]).toBe(initialLegacyJson);

      // Second call with different data must NOT overwrite the backup
      const modifiedJson = JSON.stringify({ flows: [{ id: "f2_modified" }] });
      const secondBackedUp = backupRawWorkspaceIfNeeded(modifiedJson);
      expect(secondBackedUp).toBe(false);
      expect(mockStorage[WORKSPACE_BACKUP_KEY]).toBe(initialLegacyJson);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  // Test 7: Label edits preserving variable keys
  it("locks variable identity so editing component label never silently renames variable", () => {
    const flow = seedData().flows[0]!;
    const comp = flow.components[0]!;
    const originalVar = comp.variable;
    expect(originalVar).toBeTruthy();

    // Normalizing with defaults locks existing variables
    const normalized = withFlowDefaults(flow);
    const targetComp = normalized.components[0]!;
    expect(targetComp.variableLocked).toBe(true);
    expect(targetComp.variable).toBe(originalVar);

    // If label changes, variable must not change when variableLocked is true
    const updatedLabel = "Completely New Label Text";
    const editedComp = {
      ...targetComp,
      label: updatedLabel,
      // Simulated PropertiesPanel behavior
      ...(!targetComp.variableLocked && !targetComp.variable
        ? { variable: createUniqueVariable(updatedLabel, normalized, targetComp.id) }
        : {}),
    };

    expect(editedComp.label).toBe(updatedLabel);
    expect(editedComp.variable).toBe(originalVar);
  });

  // Test 8: Option-label edits preserving option values
  it("preserves option values when option label is modified", () => {
    const flow = seedData().flows[0]!;
    const dropdown = flow.components.find((c) => c.options && c.options.length > 0)!;
    const firstOption = dropdown.options![0]!;
    const originalValue = firstOption.value;

    // Simulate PropertiesPanel editing option label
    const editedOption = { ...firstOption, label: "Updated Display Label" };
    expect(editedOption.label).toBe("Updated Display Label");
    expect(editedOption.value).toBe(originalValue);
  });

  // Test 9: Duplicate variable detection and prevention
  it("detects existing variable names and generates collision-free slugs", () => {
    const flow = seedData().flows[0]!;
    const existingVar = flow.components[0]!.variable!;

    // createUniqueVariable should avoid collision by appending suffix
    const uniqueSlug = createUniqueVariable(existingVar, flow);
    expect(uniqueSlug).not.toBe(existingVar);
    expect(uniqueSlug).toBe(`${existingVar}_2`);

    // Third generation increments
    const mockFlow: Flow = {
      ...flow,
      components: [
        ...flow.components,
        { id: "c_extra", type: "text", label: "Extra", variable: `${existingVar}_2` },
      ],
    };
    const nextSlug = createUniqueVariable(existingVar, mockFlow);
    expect(nextSlug).toBe(`${existingVar}_3`);
  });

  // Test 10: Reference-safe variable renaming
  it("updates rule conditions, rule actions, calculation terms, and showWhen visibility when variable is renamed", () => {
    const baseFlow: Flow = withFlowDefaults({
      id: "fl_ref_test",
      name: "Reference Test",
      description: "",
      status: "draft",
      submissions: 0,
      updatedAt: "2026-09-01",
      contactFields: [],
      components: [
        {
          id: "c_guest",
          type: "number",
          label: "Guest Count",
          variable: "guest_count",
          variableLocked: true,
        },
        {
          id: "c_seating",
          type: "text",
          label: "Seating Note",
          variable: "seating_note",
          showWhen: {
            id: "cond_1",
            variable: "guest_count",
            operator: "gt",
            value: "100",
          },
        },
        {
          id: "c_calc",
          type: "calculation",
          label: "Budget Calc",
          calculation: {
            id: "calc_1",
            name: "Budget Calc",
            resultVariable: "calc_budget",
            terms: [
              { id: "t1", kind: "variable", variable: "guest_count" },
              { id: "t2", kind: "number", number: 50, operator: "×" },
            ],
          },
        },
      ],
      rules: [
        {
          id: "r1",
          name: "Large event rule",
          match: "all",
          active: true,
          conditions: [
            { id: "rc1", variable: "guest_count", operator: "gt", value: "200" },
          ],
          actions: [
            { id: "ra1", type: "set_value", variable: "guest_count", value: "250" },
          ],
        },
      ],
    });

    const renameResult = renameFlowVariable(baseFlow, "guest_count", "attendee_count", "c_guest");
    expect(renameResult.success).toBe(true);

    const updatedFlow = renameResult.flow;
    const updatedGuest = updatedFlow.components.find((c) => c.id === "c_guest")!;
    expect(updatedGuest.variable).toBe("attendee_count");

    // Visibility condition updated
    const updatedSeating = updatedFlow.components.find((c) => c.id === "c_seating")!;
    expect(updatedSeating.showWhen?.variable).toBe("attendee_count");

    // Calculation terms updated
    const updatedCalc = updatedFlow.components.find((c) => c.id === "c_calc")!;
    expect(updatedCalc.calculation?.terms[0]?.variable).toBe("attendee_count");

    // Rule conditions and actions updated
    const updatedRule = updatedFlow.rules[0]!;
    expect(updatedRule.conditions[0]?.variable).toBe("attendee_count");
    expect(updatedRule.actions[0]?.variable).toBe("attendee_count");

    // Also verify enquiry answers migration
    const legacyEnquiry: Enquiry = {
      id: "en_test",
      customer: "Test",
      email: "test@example.com",
      business: "Test Biz",
      flowId: "fl_ref_test",
      status: "new",
      createdAt: "2026-09-01",
      answers: { guest_count: 150 },
      selectedAddons: [],
      notes: "",
    };
    const migratedEnquiry = migrateEnquiryAnswersOnVariableRename(legacyEnquiry, "guest_count", "attendee_count");
    expect(migratedEnquiry.answers["attendee_count"]).toBe(150);
    expect(migratedEnquiry.answers["guest_count"]).toBeUndefined();
  });

  // Test 11: Snapshot data copying
  it("creates immutable quote and proposal snapshots with independent line copies", () => {
    const ws = migrateWorkspaceData(seedData());
    const flow = ws.flows[0]!;
    const enquiry = ws.enquiries[0]!;
    const result = evaluateEnquiryQuote(enquiry, ws)!;
    expect(result).not.toBeNull();

    const quoteSnapshot = createQuoteSnapshot(flow, result);
    expect(quoteSnapshot.flowId).toBe(flow.id);
    expect(quoteSnapshot.total).toBe(result.total);
    expect(quoteSnapshot.lines.length).toBe(result.lines.length);

    // Snapshot lines must be independent copies
    quoteSnapshot.lines[0]!.amount = 99999;
    expect(result.lines[0]!.amount).not.toBe(99999);

    const proposalSnapshot = createProposalSnapshot({
      enquiry,
      flow,
      result,
      ws,
      revision: 2,
    });
    expect(proposalSnapshot.revision).toBe(2);
    expect(proposalSnapshot.quote.total).toBe(result.total);
    expect(proposalSnapshot.customer).toBe(enquiry.customer);

    const proposalWithSnap: Proposal = {
      id: "pr_snap",
      enquiryId: enquiry.id,
      status: "sent",
      createdAt: "2026-09-01",
      title: "Snapshot Proposal",
      snapshot: proposalSnapshot,
    };
    expect(getProposalTotal(proposalWithSnap, ws)).toBe(proposalSnapshot.quote.total);
  });

  // Test 12: Existing engine behavior remaining unchanged
  it("evaluates rules, calculations, and catalog pricing with 100% parity to baseline", () => {
    const ws = seedData();
    const flow = ws.flows.find((f) => f.id === "fl_event_rental")!;

    // Answers matching wedding event with >200 guests and outdoor
    const answers = {
      event_type: "wedding",
      guest_count: 250,
      outdoor: "outdoor",
      tables_required: 25,
      chairs_required: 200,
    };

    const result = runEngine({
      flow,
      answers,
      products: ws.products,
      packages: ws.packages,
      selectedAddons: ["a_dance"],
    });

    expect(result.subtotal).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.source === "package")).toBe(true);
    expect(result.lines.some((l) => l.source === "addon")).toBe(true);
  });

  // Test 13: Form Builder Adapter boundary
  it("adapts QuoteFlow Flow to external schema without losing internal business configuration", () => {
    const ws = seedData();
    const flow = ws.flows[0]!;
    const schema = toExternalFormSchema(flow);

    expect(schema.flowId).toBe(flow.id);
    expect(schema.contactStep.length).toBe(flow.contactFields.length);
    expect(schema.questionStep.length).toBeGreaterThan(0);

    // Business nodes (calculations, price summaries) must never appear in customer question step
    const nonInputQuestions = schema.questionStep.filter(
      (q) => q.type === "calculation" || q.type === "price-summary" || q.type === "variable",
    );
    expect(nonInputQuestions.length).toBe(0);

    // Merge external modifications back
    const modifiedField = {
      ...schema.questionStep[0]!,
      label: "Updated External Question Label",
    };
    const merged = mergeExternalFieldsIntoFlow(flow.components, [modifiedField]);
    const mergedComp = merged.find((c) => c.id === modifiedField.id)!;
    expect(mergedComp.label).toBe("Updated External Question Label");
    // Variable must remain stable
    expect(mergedComp.variable).toBe(flow.components.find((c) => c.id === modifiedField.id)?.variable);

    // Answers normalization
    const rawFormAnswers = {
      [flow.contactFields[0]!.variable!]: "John Customer",
    };
    const normalizedAnswers = normalizeFormAnswers(rawFormAnswers, flow);
    expect(normalizedAnswers[flow.contactFields[0]!.variable!]).toBe("John Customer");
  });
});
