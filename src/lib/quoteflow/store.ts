import { useCallback, useSyncExternalStore } from "react";
import { seedData } from "./seed";
import { withFlowDefaults } from "./defaults";
import type { Enquiry, Flow, Package, Product, Proposal, WorkspaceData } from "./types";

const KEY = "quoteflow.workspace.v1";

let state: WorkspaceData = seedData();
let hydrated = false;
const listeners = new Set<() => void>();

function normalize(data: WorkspaceData): WorkspaceData {
  return { ...data, flows: (data.flows ?? []).map((f) => withFlowDefaults(f)) };
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = normalize({ ...seedData(), ...(JSON.parse(raw) as WorkspaceData) });
  } catch {
    /* ignore */
  }
}


function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => {
  hydrate();
  return state;
};
const getServerSnapshot = () => state;

export function setState(updater: (s: WorkspaceData) => WorkspaceData) {
  state = updater(state);
  persist();
  emit();
}

export function useWorkspace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function resetWorkspace() {
  state = seedData();
  persist();
  emit();
}

export function useActions() {
  return {
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
    upsertEnquiry: useCallback((e: Enquiry) => {
      setState((s) => ({
        ...s,
        enquiries: s.enquiries.some((x) => x.id === e.id) ? s.enquiries.map((x) => (x.id === e.id ? e : x)) : [e, ...s.enquiries],
      }));
    }, []),
    upsertProposal: useCallback((p: Proposal) => {
      setState((s) => ({
        ...s,
        proposals: s.proposals.some((x) => x.id === p.id) ? s.proposals.map((x) => (x.id === p.id ? p : x)) : [p, ...s.proposals],
      }));
    }, []),
  };
}