import { useCallback, useSyncExternalStore } from "react";
import { seedData } from "./seed";
import {
  CURRENT_SCHEMA_VERSION,
  defaultWorkspaceSettings,
} from "./defaults";
import {
  WORKSPACE_BACKUP_KEY,
  WORKSPACE_RESET_BACKUP_KEY,
  WORKSPACE_STORAGE_KEY,
  backupRawWorkspaceIfNeeded,
  migrateWorkspaceData,
} from "./migrations";
import type {
  Enquiry,
  Flow,
  Package,
  Product,
  Proposal,
  WorkspaceData,
  WorkspaceSettings,
} from "./types";

let state: WorkspaceData = migrateWorkspaceData(seedData());
let hydrated = false;
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[QuoteFlow Storage] Failed to persist workspace to localStorage (quota or privacy mode):", error);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      console.error(
        "[QuoteFlow Storage] Stored workspace JSON is malformed. Preserving raw backup and aborting migration.",
        parseError,
      );
      backupRawWorkspaceIfNeeded(raw);
      return;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      typeof (parsed as { schemaVersion: unknown }).schemaVersion === "number" &&
      ((parsed as { schemaVersion: number }).schemaVersion > CURRENT_SCHEMA_VERSION)
    ) {
      console.warn(
        `[QuoteFlow Storage] Unsupported future schema version (${(parsed as { schemaVersion: number }).schemaVersion}). Preserving existing storage.`,
      );
      return;
    }

    backupRawWorkspaceIfNeeded(raw);
    state = migrateWorkspaceData(parsed);
    persist();
  } catch (error) {
    console.error("[QuoteFlow Storage] Hydration / migration encountered an error:", error);
  }
}

function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getSnapshot = () => {
  hydrate();
  return state;
};

export const getWorkspaceState = getSnapshot;

export const getServerSnapshot = () => state;

export function setState(updater: (s: WorkspaceData) => WorkspaceData) {
  hydrate();
  state = updater(state);
  persist();
  emit();
}

export function useWorkspace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function resetWorkspace() {
  if (typeof window !== "undefined") {
    try {
      const currentRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (currentRaw) {
        // Save manual reset snapshot to a dedicated key so pre-migration backup is never overwritten
        window.localStorage.setItem(WORKSPACE_RESET_BACKUP_KEY, currentRaw);
      }
    } catch {
      /* ignore */
    }
  }
  state = migrateWorkspaceData(seedData());
  persist();
  emit();
}

export function restoreWorkspaceBackup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const backupRaw = window.localStorage.getItem(WORKSPACE_BACKUP_KEY);
    if (!backupRaw) return false;
    state = migrateWorkspaceData(JSON.parse(backupRaw));
    persist();
    emit();
    return true;
  } catch (err) {
    console.error("[QuoteFlow Storage] Failed to restore migration backup:", err);
    return false;
  }
}

export function restoreWorkspaceResetBackup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const resetRaw = window.localStorage.getItem(WORKSPACE_RESET_BACKUP_KEY);
    if (!resetRaw) return false;
    state = migrateWorkspaceData(JSON.parse(resetRaw));
    persist();
    emit();
    return true;
  } catch (err) {
    console.error("[QuoteFlow Storage] Failed to restore reset backup:", err);
    return false;
  }
}

export function recordSubmission(opts: {
  enquiry: Enquiry;
  proposal?: Proposal | undefined;
  flowId: string;
}): boolean {
  hydrate();
  const prevFlow = state.flows.find((f) => f.id === opts.flowId);
  const updatedFlows = prevFlow
    ? state.flows.map((f) =>
        f.id === opts.flowId
          ? { ...f, submissions: f.submissions + 1, updatedAt: new Date().toISOString().slice(0, 10) }
          : f,
      )
    : state.flows;

  const nextEnquiries = [opts.enquiry, ...state.enquiries.filter((e) => e.id !== opts.enquiry.id)];
  const nextProposals = opts.proposal
    ? [opts.proposal, ...state.proposals.filter((p) => p.id !== opts.proposal!.id)]
    : state.proposals;

  const nextState: WorkspaceData = {
    ...state,
    flows: updatedFlows,
    enquiries: nextEnquiries,
    proposals: nextProposals,
  };

  // If in browser, verify storage write BEFORE committing in-memory state
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(nextState));
    } catch (err) {
      console.error("[QuoteFlow Storage] Failed to persist submission to localStorage:", err);
      throw err;
    }
  }

  state = nextState;
  emit();
  return true;
}

export function useActions() {
  return {
    recordSubmission: useCallback((opts: { enquiry: Enquiry; proposal?: Proposal | undefined; flowId: string }) => {
      return recordSubmission(opts);
    }, []),
    upsertFlow: useCallback((flow: Flow) => {
      setState((s) => {
        const next = { ...flow, updatedAt: new Date().toISOString().slice(0, 10) };
        const exists = s.flows.some((f) => f.id === flow.id);
        return { ...s, flows: exists ? s.flows.map((f) => (f.id === flow.id ? next : f)) : [next, ...s.flows] };
      });
    }, []),
    deleteFlow: useCallback((id: string) => {
      setState((s) => ({ ...s, flows: s.flows.filter((f) => f.id !== id) }));
    }, []),
    upsertProduct: useCallback((p: Product) => {
      setState((s) => ({
        ...s,
        products: s.products.some((x) => x.id === p.id) ? s.products.map((x) => (x.id === p.id ? p : x)) : [p, ...s.products],
      }));
    }, []),
    deleteProduct: useCallback((id: string) => {
      setState((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));
    }, []),
    upsertPackage: useCallback((p: Package) => {
      setState((s) => ({
        ...s,
        packages: s.packages.some((x) => x.id === p.id) ? s.packages.map((x) => (x.id === p.id ? p : x)) : [p, ...s.packages],
      }));
    }, []),
    deletePackage: useCallback((id: string) => {
      setState((s) => ({ ...s, packages: s.packages.filter((p) => p.id !== id) }));
    }, []),
    upsertEnquiry: useCallback((e: Enquiry) => {
      setState((s) => ({
        ...s,
        enquiries: s.enquiries.some((x) => x.id === e.id) ? s.enquiries.map((x) => (x.id === e.id ? e : x)) : [e, ...s.enquiries],
      }));
    }, []),
    deleteEnquiry: useCallback((id: string) => {
      setState((s) => ({ ...s, enquiries: s.enquiries.filter((e) => e.id !== id) }));
    }, []),
    upsertProposal: useCallback((p: Proposal) => {
      setState((s) => ({
        ...s,
        proposals: s.proposals.some((x) => x.id === p.id) ? s.proposals.map((x) => (x.id === p.id ? p : x)) : [p, ...s.proposals],
      }));
    }, []),
    updateSettings: useCallback((patch: Partial<WorkspaceSettings>) => {
      setState((s) => ({
        ...s,
        settings: { ...defaultWorkspaceSettings(), ...(s.settings ?? {}), ...patch },
      }));
    }, []),
  };
}
