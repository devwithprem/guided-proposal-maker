import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/quoteflow/AppShell";
import { useWorkspace } from "@/lib/quoteflow/store";
import { actionLabels, operatorLabels } from "@/lib/quoteflow/engine";
import { ArrowRight, GitBranch } from "lucide-react";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rules — QuoteFlow" },
      { name: "description", content: "Every WHEN/THEN rule across your flows in one auditable list." },
      { property: "og:title", content: "Rules — QuoteFlow" },
      { property: "og:description", content: "Every WHEN/THEN rule across your flows in one auditable list." },
    ],
  }),
  component: RulesPage,
});

function RulesPage() {
  const ws = useWorkspace();
  const all = ws.flows.flatMap((f) => f.rules.map((r) => ({ flow: f, rule: r })));

  return (
    <AppShell>
      <PageHeader title="Rules" description="All logic across every flow. Edit rules inside the flow they belong to." />
      <div className="space-y-3 p-6">
        {ws.flows.map((flow) => (
          <div key={flow.id} className="qf-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13.5px] font-semibold">{flow.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {flow.rules.length} rule{flow.rules.length === 1 ? "" : "s"}
                </span>
              </div>
              <Link
                to="/flows/$flowId"
                params={{ flowId: flow.id }}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
              >
                Open builder <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="divide-y divide-border">
              {flow.rules.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{r.name}</span>
                    <span
                      className={
                        r.active
                          ? "rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand"
                          : "rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
                      }
                    >
                      {r.active ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {r.conditions.map((c, i) => (
                      <span key={c.id} className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                          {i === 0 ? "when" : r.match === "all" ? "and" : "or"}
                        </span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{c.variable}</code>
                        <span className="text-muted-foreground">{operatorLabels[c.operator]}</span>
                        {c.value && <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{c.value}</code>}
                      </span>
                    ))}
                    {r.actions.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold uppercase text-brand">then</span>
                        <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11.5px] text-brand">
                          {actionLabels[a.type]}
                          {a.label ? ` · ${a.label}` : ""}
                          {typeof a.amount === "number" ? ` · $${a.amount}` : ""}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {flow.rules.length === 0 && (
                <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">No rules in this flow yet.</p>
              )}
            </div>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">{all.length} rules total.</p>
      </div>
    </AppShell>
  );
}
