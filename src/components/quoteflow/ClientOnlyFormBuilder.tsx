import { useCallback, useEffect, useState } from "react";
import { FormBuilder, LocaleProvider } from "@devcode-tech/form-builder";
import type { FormBuilderSaveData } from "@devcode-tech/form-builder";
import type { Flow } from "@/lib/quoteflow/types";
import {
  mergeFormBuilderDataIntoFlow,
  toFormBuilderSchema,
} from "@/lib/quoteflow/form-builder-adapter";
import "@devcode-tech/form-builder/index.css";

export interface ClientOnlyFormBuilderProps {
  flow: Flow;
  onSaveFlow: (patch: Partial<Flow>) => void;
  workspaceBrandColor?: string;
  onClose?: () => void;
}

export function ClientOnlyFormBuilder({
  flow,
  onSaveFlow,
  workspaceBrandColor = "#0f766e",
  onClose,
}: ClientOnlyFormBuilderProps) {
  const [mounted, setMounted] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLoad = useCallback(
    async (_formId: string) => {
      return toFormBuilderSchema(flow);
    },
    [flow],
  );

  const handleSave = useCallback(
    async (data: FormBuilderSaveData) => {
      setSaveStatus("saving");
      try {
        const updated = mergeFormBuilderDataIntoFlow(flow, data);
        onSaveFlow(updated);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
        return flow.id;
      } catch (err) {
        setSaveStatus("idle");
        console.error("Failed to save Form Builder data:", err);
        return null;
      }
    },
    [flow, onSaveFlow],
  );

  const handleUpdate = useCallback(
    async (_formId: string, data: FormBuilderSaveData) => {
      setSaveStatus("saving");
      try {
        const updated = mergeFormBuilderDataIntoFlow(flow, data);
        onSaveFlow(updated);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
        return true;
      } catch (err) {
        setSaveStatus("idle");
        console.error("Failed to update Form Builder data:", err);
        return false;
      }
    },
    [flow, onSaveFlow],
  );

  const handleAutoSave = useCallback(
    async (_formId: string, data: FormBuilderSaveData) => {
      try {
        const updated = mergeFormBuilderDataIntoFlow(flow, data);
        onSaveFlow(updated);
      } catch (err) {
        console.warn("Auto-save sync warning:", err);
      }
    },
    [flow, onSaveFlow],
  );

  if (!mounted) {
    return (
      <div className="flex min-h-[480px] w-full items-center justify-center rounded-xl border border-border bg-card p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-[13px] text-muted-foreground">Initializing Visual Form Builder...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-[620px] w-full overflow-hidden rounded-xl border border-border bg-background shadow-xs">
      <div className="flex items-center justify-between border-b border-border bg-sidebar/50 px-4 py-2 text-[12.5px]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-foreground">Visual Form Builder</span>
          <span className="text-muted-foreground">
            Changes auto-sync with QuoteFlow rules, variables &amp; pricing
          </span>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === "saving" && (
            <span className="text-[11px] font-medium text-brand animate-pulse">Syncing...</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[11px] font-medium text-emerald-600">Saved</span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              Exit Builder
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 w-full p-2">
        <LocaleProvider locale="en">
          <FormBuilder
            initialFormId={flow.id}
            onLoad={handleLoad}
            onSave={handleSave}
            onUpdate={handleUpdate}
            onAutoSave={handleAutoSave}
            workspaceBrandColor={workspaceBrandColor}
            enableAutoSave={true}
          />
        </LocaleProvider>
      </div>
    </div>
  );
}

