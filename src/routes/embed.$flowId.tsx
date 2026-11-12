import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { FlowPreview } from "@/components/quoteflow/FlowPreview";
import { useWorkspace } from "@/lib/quoteflow/store";

export const Route = createFileRoute("/embed/$flowId")({
  head: () => ({
    meta: [
      { title: "Request a quote" },
      { name: "description", content: "Answer a few questions and get an instant, itemised estimate." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Request a quote" },
      { property: "og:description", content: "Answer a few questions and get an instant, itemised estimate." },
    ],
  }),
  component: EmbeddedFlow,
});

function resolveValidatedParentOrigin(): string {
  if (typeof window === "undefined") return "";
  try {
    if (document.referrer) {
      const parsed = new URL(document.referrer);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    }
  } catch {
    /* fall back to same-origin */
  }
  return window.location.origin;
}

function EmbeddedFlow() {
  const { flowId } = Route.useParams();
  const ws = useWorkspace();
  const flow = ws.flows.find(
    (f) => f.id === flowId || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === flowId,
  );

  const targetOrigin = useMemo(() => resolveValidatedParentOrigin(), []);

  // Report height to the host page using safe resize notification
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    const post = () => {
      try {
        window.parent?.postMessage(
          { type: "quoteflow:resize", flowId, height: document.documentElement.scrollHeight },
          "*",
        );
      } catch {
        /* ignore cross-origin postMessage restriction */
      }
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [flowId]);

  if (!flow) {
    return (
      <div className="p-10 text-center text-[13.5px] text-muted-foreground">
        This form is no longer available.
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <FlowPreview flow={flow} record parentOrigin={targetOrigin} />
    </main>
  );
}
