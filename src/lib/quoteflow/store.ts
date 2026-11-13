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
import {
  deleteFlowServerFn,
  deletePackageServerFn,
  deleteProductServerFn,
  getWorkspaceServerFn,
  importLegacyWorkspaceServerFn,
  resetServerWorkspaceServerFn,
  updateEnquiryMetaServerFn,
  updateSettingsServerFn,
  upsertFlowServerFn,
  upsertPackageServerFn,
  upsertProductServerFn,
} from "./server-fns";
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
let serverRevision = 1;
let lastConfirmedServerSnapshot: WorkspaceData | null = null;
let syncStatus: "idle" | "syncing" | "error" = "idle";
let lastSyncError: string | null = null;
const listeners = new Set<() => void>();

const debouncedTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debounceMutation(key: string, delayMs: number, fn: () => Promise<void>) {
  const existing = debouncedTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    debouncedTimers.delete(key);
    try {
      await fn();
    } catch {
      // errors surfaced via syncStatus
    }
  }, delayMs);
  debouncedTimers.set(key, timer);
}

export function flushPendingDebouncedMutations(): void {
  debouncedTimers.forEach((timer) => clearTimeout(timer));
  debouncedTimers.clear();
}

function emit() {
  listeners.forEach((l) => l());
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    // Only read localStorage to detect legacy data; do NOT overwrite state with unverified local data
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      typeof (parsed as { schemaVersion: unknown }).schemaVersion === "number" &&
      (parsed as { schemaVersion: number }).schemaVersion > CURRENT_SCHEMA_VERSION
    ) {
      return;
    }

    backupRawWorkspaceIfNeeded(raw);
  } catch (error) {
    console.error("[QuoteFlow Storage] Legacy storage inspection error:", error);
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

export function getServerRevision(): number {
  return serverRevision;
}

export function getSyncStatus(): { syncStatus: "idle" | "syncing" | "error"; lastSyncError: string | null } {
  return { syncStatus, lastSyncError };
}

export function setState(updater: (s: WorkspaceData) => WorkspaceData) {
  hydrate();
  state = updater(state);
  emit();
}

export function useWorkspace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useSyncStatus() {
  return useSyncExternalStore(
    subscribe,
    getSyncStatus,
    () => ({ syncStatus: "idle" as const, lastSyncError: null }),
  );
}

/**
 * Hydrates or refreshes the client store from authoritative server SQLite database.
 */
export async function syncFromServer(options?: { force?: boolean }): Promise<WorkspaceData | null> {
  if (typeof window === "undefined") return null;

  syncStatus = "syncing";
  emit();

  try {
    const res = await getWorkspaceServerFn();
    state = res.workspace;
    serverRevision = res.revision;
    lastConfirmedServerSnapshot = res.workspace;
    syncStatus = "idle";
    lastSyncError = null;
    emit();
    return res.workspace;
  } catch (err) {
    syncStatus = "error";
    lastSyncError = (err as Error).message || "Failed to load workspace from server.";
    emit();
    return null;
  }
}

export interface LegacyLocalDataSummary {
  flowsCount: number;
  productsCount: number;
  packagesCount: number;
  enquiriesCount: number;
  proposalsCount: number;
}

export function checkLegacyLocalData(): {
  hasLegacy: boolean;
  summary: LegacyLocalDataSummary | null;
  raw: string | null;
} {
  if (typeof window === "undefined") return { hasLegacy: false, summary: null, raw: null };
  try {
    const synced = window.localStorage.getItem("quoteflow.synced_to_server.v1");
    if (synced) return { hasLegacy: false, summary: null, raw: null };

    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { hasLegacy: false, summary: null, raw: null };

    const parsed = JSON.parse(raw);
    const summary: LegacyLocalDataSummary = {
      flowsCount: Array.isArray(parsed.flows) ? parsed.flows.length : 0,
      productsCount: Array.isArray(parsed.products) ? parsed.products.length : 0,
      packagesCount: Array.isArray(parsed.packages) ? parsed.packages.length : 0,
      enquiriesCount: Array.isArray(parsed.enquiries) ? parsed.enquiries.length : 0,
      proposalsCount: Array.isArray(parsed.proposals) ? parsed.proposals.length : 0,
    };
    return { hasLegacy: true, summary, raw };
  } catch {
    return { hasLegacy: false, summary: null, raw: null };
  }
}

export async function importLegacyLocalData(options?: { overrideCatalog?: boolean }): Promise<{
  success: boolean;
  importedCounts?: { flows: number; products: number; packages: number; enquiries: number };
  error?: string;
}> {
  if (typeof window === "undefined") return { success: false, error: "Not in browser" };
  const check = checkLegacyLocalData();
  if (!check.hasLegacy || !check.raw) {
    return { success: false, error: "No unmigrated local data found." };
  }

  try {
    const parsed = JSON.parse(check.raw);
    const res = await importLegacyWorkspaceServerFn({
      data: {
        legacyData: parsed,
        overrideCatalog: options?.overrideCatalog,
      },
    });

    window.localStorage.setItem("quoteflow.synced_to_server.v1", new Date().toISOString());
    state = res.workspace;
    serverRevision = res.workspaceRevision;
    lastConfirmedServerSnapshot = res.workspace;
    syncStatus = "idle";
    lastSyncError = null;
    emit();

    return { success: true, importedCounts: res.importedCounts };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function dismissLegacyLocalData(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("quoteflow.synced_to_server.v1", "dismissed");
  }
  emit();
}

export function resetWorkspace() {
  if (typeof window !== "undefined") {
    try {
      const currentRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (currentRaw) {
        window.localStorage.setItem(WORKSPACE_RESET_BACKUP_KEY, currentRaw);
      }
    } catch {
      /* ignore */
    }

    resetServerWorkspaceServerFn({ data: { confirm: true } })
      .then((res) => {
        state = res.workspace;
        serverRevision = res.workspaceRevision;
        lastConfirmedServerSnapshot = res.workspace;
        syncStatus = "idle";
        emit();
      })
      .catch((err) => {
        syncStatus = "error";
        lastSyncError = (err as Error).message;
        emit();
      });
  }

  state = migrateWorkspaceData(seedData());
  emit();
}

export function restoreWorkspaceBackup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const backupRaw = window.localStorage.getItem(WORKSPACE_BACKUP_KEY);
    if (!backupRaw) return false;
    state = migrateWorkspaceData(JSON.parse(backupRaw));
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

  // If in browser, verify storage write BEFORE committing in-memory state (Sprint 4 Scenario 24 contract)
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
      const prevSnapshot = state;
      setState((s) => {
        const next = { ...flow, updatedAt: new Date().toISOString().slice(0, 10) };
        const exists = s.flows.some((f) => f.id === flow.id);
        return { ...s, flows: exists ? s.flows.map((f) => (f.id === flow.id ? next : f)) : [next, ...s.flows] };
      });

      if (typeof window !== "undefined") {
        debounceMutation(`flow_${flow.id}`, 250, async () => {
          try {
            syncStatus = "syncing";
            emit();
            const res = await upsertFlowServerFn({
              data: { flow, expectedRevision: serverRevision },
            });
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          } catch (err) {
            // Rollback on conflict or failure
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message || "Failed to save flow to server.";
            emit();
          }
        });
      }
    }, []),

    deleteFlow: useCallback((id: string) => {
      const prevSnapshot = state;
      setState((s) => ({ ...s, flows: s.flows.filter((f) => f.id !== id) }));

      if (typeof window !== "undefined") {
        deleteFlowServerFn({ data: { flowId: id, expectedRevision: serverRevision } })
          .then((res) => {
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          })
          .catch((err) => {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message;
            emit();
          });
      }
    }, []),

    upsertProduct: useCallback((p: Product) => {
      const prevSnapshot = state;
      setState((s) => ({
        ...s,
        products: s.products.some((x) => x.id === p.id)
          ? s.products.map((x) => (x.id === p.id ? p : x))
          : [p, ...s.products],
      }));

      if (typeof window !== "undefined") {
        debounceMutation(`prod_${p.id}`, 250, async () => {
          try {
            syncStatus = "syncing";
            emit();
            const res = await upsertProductServerFn({
              data: { product: p, expectedRevision: serverRevision },
            });
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          } catch (err) {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message || "Failed to save product to server.";
            emit();
          }
        });
      }
    }, []),

    deleteProduct: useCallback((id: string) => {
      const prevSnapshot = state;
      setState((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));

      if (typeof window !== "undefined") {
        deleteProductServerFn({ data: { productId: id, expectedRevision: serverRevision } })
          .then((res) => {
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          })
          .catch((err) => {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message;
            emit();
          });
      }
    }, []),

    upsertPackage: useCallback((pkg: Package) => {
      const prevSnapshot = state;
      setState((s) => ({
        ...s,
        packages: s.packages.some((x) => x.id === pkg.id)
          ? s.packages.map((x) => (x.id === pkg.id ? pkg : x))
          : [pkg, ...s.packages],
      }));

      if (typeof window !== "undefined") {
        debounceMutation(`pkg_${pkg.id}`, 250, async () => {
          try {
            syncStatus = "syncing";
            emit();
            const res = await upsertPackageServerFn({
              data: { pkg, expectedRevision: serverRevision },
            });
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          } catch (err) {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message || "Failed to save package to server.";
            emit();
          }
        });
      }
    }, []),

    deletePackage: useCallback((id: string) => {
      const prevSnapshot = state;
      setState((s) => ({ ...s, packages: s.packages.filter((p) => p.id !== id) }));

      if (typeof window !== "undefined") {
        deletePackageServerFn({ data: { packageId: id, expectedRevision: serverRevision } })
          .then((res) => {
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          })
          .catch((err) => {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message;
            emit();
          });
      }
    }, []),

    upsertEnquiry: useCallback((e: Enquiry) => {
      const prevSnapshot = state;
      setState((s) => ({
        ...s,
        enquiries: s.enquiries.some((x) => x.id === e.id)
          ? s.enquiries.map((x) => (x.id === e.id ? e : x))
          : [e, ...s.enquiries],
      }));

      if (typeof window !== "undefined") {
        updateEnquiryMetaServerFn({
          data: {
            enquiryId: e.id,
            status: e.status,
            notes: e.notes,
            expectedRevision: serverRevision,
          },
        })
          .then((res) => {
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          })
          .catch((err) => {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message;
            emit();
          });
      }
    }, []),

    deleteEnquiry: useCallback((id: string) => {
      setState((s) => ({ ...s, enquiries: s.enquiries.filter((e) => e.id !== id) }));
    }, []),

    upsertProposal: useCallback((p: Proposal) => {
      setState((s) => ({
        ...s,
        proposals: s.proposals.some((x) => x.id === p.id)
          ? s.proposals.map((x) => (x.id === p.id ? p : x))
          : [p, ...s.proposals],
      }));
    }, []),

    updateSettings: useCallback((patch: Partial<WorkspaceSettings>) => {
      const prevSnapshot = state;
      setState((s) => ({
        ...s,
        settings: { ...defaultWorkspaceSettings(), ...(s.settings ?? {}), ...patch },
      }));

      if (typeof window !== "undefined") {
        debounceMutation("workspace_settings", 300, async () => {
          try {
            syncStatus = "syncing";
            emit();
            const res = await updateSettingsServerFn({
              data: { settings: patch, expectedRevision: serverRevision },
            });
            serverRevision = res.workspaceRevision;
            lastConfirmedServerSnapshot = state;
            syncStatus = "idle";
            lastSyncError = null;
            emit();
          } catch (err) {
            state = lastConfirmedServerSnapshot ?? prevSnapshot;
            syncStatus = "error";
            lastSyncError = (err as Error).message || "Failed to update settings.";
            emit();
          }
        });
      }
    }, []),
  };
}
