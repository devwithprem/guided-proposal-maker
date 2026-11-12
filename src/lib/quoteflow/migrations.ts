import {
  CURRENT_SCHEMA_VERSION,
  defaultWorkspaceSettings,
  withEnquiryDefaults,
  withFlowDefaults,
  withProposalDefaults,
} from "./defaults";
import { seedData } from "./seed";
import type { WorkspaceData } from "./types";

export const WORKSPACE_STORAGE_KEY = "quoteflow.workspace.v1";
export const WORKSPACE_BACKUP_KEY = "quoteflow.workspace.v1.backup";
export const WORKSPACE_RESET_BACKUP_KEY = "quoteflow.workspace.v1.reset_backup";

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly code: "UNSUPPORTED_VERSION" | "MALFORMED_DATA" | "INVALID_PAYLOAD",
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Saves an untouched copy of legacy localStorage data before running a version upgrade.
 * Never overwrites an existing backup once created, ensuring raw recoverability.
 */
export function backupRawWorkspaceIfNeeded(rawJson: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const existingBackup = window.localStorage.getItem(WORKSPACE_BACKUP_KEY);
    if (!existingBackup) {
      window.localStorage.setItem(WORKSPACE_BACKUP_KEY, rawJson);
      return true;
    }
  } catch (err) {
    console.error("[QuoteFlow Storage] Failed to write workspace migration backup:", err);
  }
  return false;
}

interface RawWorkspaceCandidate {
  schemaVersion?: unknown;
  flows?: unknown;
  products?: unknown;
  packages?: unknown;
  enquiries?: unknown;
  proposals?: unknown;
  settings?: unknown;
}

export interface WorkspaceValidationResult {
  valid: boolean;
  reason?: string | undefined;
}

/**
 * Validates whether an unknown payload qualifies as a migratable WorkspaceData structure.
 */
export function validateWorkspacePayload(rawInput: unknown): WorkspaceValidationResult {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, reason: "Payload must be a non-null object" };
  }

  const obj = rawInput as RawWorkspaceCandidate;

  if (typeof obj.schemaVersion === "number") {
    if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        valid: false,
        reason: `Unsupported future schema version: ${obj.schemaVersion} (current: ${CURRENT_SCHEMA_VERSION})`,
      };
    }
  }

  // Must have at least one valid domain collection or settings
  const hasKnownCollections =
    Array.isArray(obj.flows) ||
    Array.isArray(obj.products) ||
    Array.isArray(obj.packages) ||
    Array.isArray(obj.enquiries) ||
    Array.isArray(obj.proposals) ||
    Boolean(obj.settings);

  if (!hasKnownCollections) {
    return { valid: false, reason: "Payload contains no recognizable workspace collections" };
  }

  return { valid: true };
}

/**
 * Non-destructively upgrades any persisted WorkspaceData payload to CURRENT_SCHEMA_VERSION.
 * Preserves all existing user records (flows, products, packages, enquiries, proposals, settings).
 * Throws MigrationError if the data is unsupported or fundamentally malformed so callers do not
 * silently wipe user data.
 */
export function migrateWorkspaceData(rawInput: unknown): WorkspaceData {
  const fallback = seedData();

  if (rawInput === undefined || rawInput === null) {
    return {
      ...fallback,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: defaultWorkspaceSettings(),
    };
  }

  if (typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new MigrationError(
      "Cannot migrate invalid workspace data: expected a JSON object",
      "MALFORMED_DATA",
    );
  }

  const candidate = rawInput as RawWorkspaceCandidate;

  if (
    typeof candidate.schemaVersion === "number" &&
    candidate.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new MigrationError(
      `Cannot migrate workspace with future schema version ${candidate.schemaVersion} (supported: ${CURRENT_SCHEMA_VERSION})`,
      "UNSUPPORTED_VERSION",
    );
  }

  // Preserve existing arrays even if empty! (Only fall back to seed if property was missing entirely)
  const rawFlows = Array.isArray(candidate.flows) ? (candidate.flows as WorkspaceData["flows"]) : fallback.flows;
  const flows = rawFlows.map((f) => withFlowDefaults(f));
  const flowMap = new Map(flows.map((f) => [f.id, f]));

  const products = Array.isArray(candidate.products)
    ? (candidate.products as WorkspaceData["products"])
    : fallback.products;
  const packages = Array.isArray(candidate.packages)
    ? (candidate.packages as WorkspaceData["packages"])
    : fallback.packages;

  const rawEnquiries = Array.isArray(candidate.enquiries)
    ? (candidate.enquiries as WorkspaceData["enquiries"])
    : fallback.enquiries;
  const enquiries = rawEnquiries.map((e) => withEnquiryDefaults(e, flowMap.get(e.flowId)));

  const rawProposals = Array.isArray(candidate.proposals)
    ? (candidate.proposals as WorkspaceData["proposals"])
    : fallback.proposals;
  const proposals = rawProposals.map((p) => withProposalDefaults(p));

  const settings = {
    ...defaultWorkspaceSettings(),
    ...((candidate.settings as WorkspaceData["settings"]) ?? {}),
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    flows,
    products,
    packages,
    enquiries,
    proposals,
    settings,
  };
}
