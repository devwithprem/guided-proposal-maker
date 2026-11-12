import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { FlowPreview } from "@/components/quoteflow/FlowPreview";
import { useWorkspace } from "@/lib/quoteflow/store";
import { getPublicFlowServerFn } from "@/lib/quoteflow/server-fns";

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
  loader: async ({ params }) => {
    try {
      const res = await getPublicFlowServerFn({ data: { flowId: params.flowId } });
      return { data: res, error: null };
    } catch (err) {
      return { data: null, error: (err as Error).message };
    }
  },
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
  const loaderData = Route.useLoaderData();
  const ws = useWorkspace();

  const flow =
    loaderData?.data?.flow ??
    ws.flows.find(
      (f) => f.id === flowId || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === flowId,
    );
  const products = loaderData?.data?.products ?? ws.products;
  const packages = loaderData?.data?.packages ?? ws.packages;

  const targetOrigin = useMemo(() => resolveValidatedParentOrigin(), []);

  // Report height to the host page using safe resize notification
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    const post = () => {
      try {
        window.parent?.postMessage(
          { type: "quoteflow:resize", flowId, height: document.documentElement.scrollHeight },
          targetOrigin || "*",
        );
      } catch {
        /* ignore cross-origin postMessage restriction */
      }
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [flowId, targetOrigin]);

  if (!flow) {
    return (
      <div className="p-10 text-center text-[13.5px] text-muted-foreground">
        This form is no longer available.
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <FlowPreview
        flow={flow}
        products={products}
        packages={packages}
        record
        parentOrigin={targetOrigin}
      />
    </main>
  );
}
