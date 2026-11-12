import { useEffect, useMemo, useState } from "react";
import { FormPreviewLive, LocaleProvider } from "@devcode-tech/form-builder";
import type { FormDesign, FormFieldData, LayoutContainer } from "@devcode-tech/form-builder";
import type { Flow } from "@/lib/quoteflow/types";
import { toFormBuilderSchema } from "@/lib/quoteflow/form-builder-adapter";
import "@devcode-tech/form-builder/index.css";

export interface ClientOnlyFormPreviewProps {
  flow: Flow;
  previewMode?: "desktop" | "mobile";
  includeContactFields?: boolean;
  workspaceBrandColor?: string;
  onUpdateContainer?: (containers: LayoutContainer[]) => void;
}

export function ClientOnlyFormPreview({
  flow,
  previewMode = "desktop",
  includeContactFields = true,
  workspaceBrandColor = "#0f766e",
  onUpdateContainer,
}: ClientOnlyFormPreviewProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const schema = useMemo(
    () => toFormBuilderSchema(flow, { includeContactFields }),
    [flow, includeContactFields],
  );

  if (!mounted) {
    return (
      <div className="flex min-h-[300px] w-full items-center justify-center rounded-xl bg-card p-8">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-[12px] text-muted-foreground">Loading preview...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <LocaleProvider locale="en">
        <FormPreviewLive
          fields={schema.fields}
          containers={schema.containers}
          formTitle={flow.settings?.headline || flow.name}
          formDescription={flow.settings?.subheadline || flow.description || ""}
          formDesign={schema.design}
          previewMode={previewMode}
          workspaceBrandColor={workspaceBrandColor}
          {...(onUpdateContainer ? { onUpdateContainer } : {})}
        />
      </LocaleProvider>
    </div>
  );
}

