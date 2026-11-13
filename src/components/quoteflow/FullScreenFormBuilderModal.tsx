import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FormBuilder,
  LocaleProvider,
  type FormBuilderRef,
  type FormBuilderSaveData,
} from "@devcode-tech/form-builder";
import type { Flow } from "@/lib/quoteflow/types";
import {
  mergeFormBuilderDataIntoFlow,
  toFormBuilderSchema,
  validateFlowFieldDeletions,
  type FieldConflict,
  type FieldDependency,
} from "@/lib/quoteflow/form-builder-adapter";
import { useActions } from "@/lib/quoteflow/store";
import { StatusPill } from "@/components/quoteflow/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, ArrowLeft, Check, Loader2, Save, X } from "lucide-react";
import "@devcode-tech/form-builder/index.css";

export interface FullScreenFormBuilderModalProps {
  open: boolean;
  flow: Flow;
  onClose: () => void;
  onSaveSuccess?: (updatedFlow: Flow) => void;
  workspaceBrandColor?: string;
}

export function FullScreenFormBuilderModal({
  open,
  flow,
  onClose,
  onSaveSuccess,
  workspaceBrandColor = "#0f766e",
}: FullScreenFormBuilderModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDependencyDialog, setShowDependencyDialog] = useState(false);
  const [pendingConflicts, setPendingConflicts] = useState<FieldConflict[]>([]);

  const internalBuilderRef = useRef<FormBuilderRef>(null);
  const pendingSavePayloadRef = useRef<FormBuilderSaveData | null>(null);
  const { upsertFlowAuthoritative } = useActions();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while modal is active
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const handleDirtyStateChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  const handleLoad = useCallback(
    async (_formId: string) => {
      return toFormBuilderSchema(flow);
    },
    [flow],
  );

  const executeFlowSave = useCallback(
    async (data: FormBuilderSaveData): Promise<boolean> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        const updatedFlow = mergeFormBuilderDataIntoFlow(flow, data);
        const res = await upsertFlowAuthoritative(updatedFlow);
        if (res.success) {
          setIsDirty(false);
          setSaveSuccess(true);
          setSaveError(null);
          setTimeout(() => setSaveSuccess(false), 2500);
          onSaveSuccess?.(updatedFlow);
          return true;
        } else {
          setSaveError(res.error || "Save conflict: flow was modified by another session.");
          return false;
        }
      } catch (err) {
        setSaveError((err as Error).message || "Unexpected failure while saving flow.");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [flow, upsertFlowAuthoritative, onSaveSuccess],
  );

  const processSaveData = useCallback(
    async (data: FormBuilderSaveData): Promise<boolean> => {
      const incomingFields = data.fields ?? data.schema?.fields ?? [];
      const incomingIds = new Set(incomingFields.map((f) => f.id));
      const check = validateFlowFieldDeletions(flow, incomingIds);

      if (!check.canDelete) {
        pendingSavePayloadRef.current = data;
        setPendingConflicts(check.conflicts);
        setShowDependencyDialog(true);
        setIsSaving(false);
        return false;
      }

      return executeFlowSave(data);
    },
    [flow, executeFlowSave],
  );

  const handleSave = useCallback(
    async (data: FormBuilderSaveData): Promise<string | null> => {
      const ok = await processSaveData(data);
      return ok ? flow.id : null;
    },
    [processSaveData, flow.id],
  );

  const handleUpdate = useCallback(
    async (_formId: string, data: FormBuilderSaveData): Promise<boolean> => {
      return processSaveData(data);
    },
    [processSaveData],
  );

  const handleTriggerSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (internalBuilderRef.current?.saveOrUpdate) {
        await internalBuilderRef.current.saveOrUpdate();
      } else {
        setIsSaving(false);
      }
    } catch (err) {
      setIsSaving(false);
      setSaveError((err as Error).message || "Failed to trigger save.");
    }
  };

  const handleConfirmDependencyProceed = async () => {
    setShowDependencyDialog(false);
    if (pendingSavePayloadRef.current) {
      const data = pendingSavePayloadRef.current;
      pendingSavePayloadRef.current = null;
      await executeFlowSave(data);
    }
  };

  const handleRequestClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Keyboard accessibility: Escape handling
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDependencyDialog) {
          setShowDependencyDialog(false);
        } else if (showUnsavedDialog) {
          setShowUnsavedDialog(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, showDependencyDialog, showUnsavedDialog, handleRequestClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visual Form Builder - ${flow.name}`}
      className="fixed inset-0 z-50 flex h-screen w-screen flex-col bg-background text-foreground"
    >
      {/* Modal Top Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar/80 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRequestClose}
            className="h-8 gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            title="Exit Form Builder"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Flow</span>
          </Button>

          <div className="h-4 w-px bg-border hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-foreground">
              {flow.name}
            </h1>
            <StatusPill status={flow.status} />
            {isDirty && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-[11px] font-medium text-amber-600"
              >
                Unsaved changes
              </Badge>
            )}
          </div>
        </div>

        {/* Center: Save Error Notification */}
        {saveError && (
          <div className="mx-2 hidden md:flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1 text-[12px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-sm">{saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              className="ml-1 text-destructive/70 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          {isSaving && (
            <div className="hidden sm:flex items-center gap-1.5 text-[12px] text-brand">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Saving to server...</span>
            </div>
          )}

          {saveSuccess && (
            <div className="hidden sm:flex items-center gap-1.5 text-[12px] text-emerald-600">
              <Check className="h-3.5 w-3.5" />
              <span>Changes saved</span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={handleRequestClose}
            className="h-8 text-[12.5px]"
          >
            Exit
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={handleTriggerSave}
            className="h-8 gap-1.5 bg-brand px-3 text-[12.5px] font-medium text-brand-foreground hover:bg-brand/90"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                <span>Save Changes</span>
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Main Form Builder Viewport Area (100% Height, No Constrained Scrolling) */}
      <main className="relative flex-1 w-full min-h-0 overflow-hidden bg-background">
        {!mounted ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-[13px] text-muted-foreground">Loading Visual Form Builder...</p>
            </div>
          </div>
        ) : (
          <LocaleProvider locale="en">
            <FormBuilder
              ref={internalBuilderRef}
              initialFormId={flow.id}
              onLoad={handleLoad}
              onSave={handleSave}
              onUpdate={handleUpdate}
              onDirtyStateChange={handleDirtyStateChange}
              workspaceBrandColor={workspaceBrandColor}
              enableAutoSave={false}
            />
          </LocaleProvider>
        )}
      </main>

      {/* Unsaved Changes Confirmation Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in the Visual Form Builder. If you exit now, your modifications
              will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedDialog(false)}>
              Keep Editing
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setIsDirty(false);
                setShowUnsavedDialog(false);
                onClose();
              }}
            >
              Discard &amp; Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dependency Conflict Warning Dialog */}
      <AlertDialog open={showDependencyDialog} onOpenChange={setShowDependencyDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertDialogTitle>Active Rule Dependencies Detected</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2 text-[13px]">
              <p>
                One or more question fields you deleted are referenced by quotation rules or
                calculations:
              </p>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-card p-2.5 text-[12px]">
                {pendingConflicts.map((c) => (
                  <div key={c.fieldId} className="mb-2 last:mb-0">
                    <p className="font-semibold text-foreground">
                      {c.label} {c.variable && <span className="font-mono text-brand">({c.variable})</span>}
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground space-y-0.5">
                      {c.dependencies.map((d) => (
                        <li key={`${d.type}_${d.id}`}>{d.description}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground">
                Deleting these fields may cause price evaluations or business rules to fail. Do you
                want to proceed anyway?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDependencyDialog(false)}>
              Keep Field &amp; Return
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDependencyProceed}
            >
              Proceed With Deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
