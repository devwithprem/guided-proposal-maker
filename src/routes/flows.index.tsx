import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { templates } from "@/lib/quoteflow/seed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Sparkles } from "lucide-react";

export const Route = createFileRoute("/flows/")({
  head: () => ({
    meta: [
      { title: "Flows — QuoteFlow" },
      { name: "description", content: "Build enquiry flows that collect requirements and price them automatically." },
      { property: "og:title", content: "Flows — QuoteFlow" },
      { property: "og:description", content: "Build enquiry flows that collect requirements and price them automatically." },
    ],
  }),
  component: FlowsPage,
});

function FlowsPage() {
  const ws = useWorkspace();
  const { upsertFlow } = useActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title="Flows"
        description="Each flow collects requirements, applies your rules and returns a configured quote."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Flow
          </Button>
        }
      />
      <div className="p-6">
        <div className="qf-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Questions</th>
                <th className="px-4 py-2">Rules</th>
                <th className="px-4 py-2">Submissions</th>
                <th className="px-4 py-2">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {ws.flows.map((f) => (
                <tr key={f.id} className="border-b border-border/70 last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link to="/flows/$flowId" params={{ flowId: f.id }} className="font-medium hover:text-brand">
                      {f.name}
                    </Link>
                    <p className="text-[12px] text-muted-foreground">{f.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={f.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {f.components.filter((c) => c.variable).length}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{f.rules.length}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{f.submissions}</td>
                  <td className="px-4 py-3 text-muted-foreground">{f.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
            <DialogDescription>
              Templates come with questions, products, rules and pricing already configured.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  const flow = t.build();
                  upsertFlow(flow);
                  setOpen(false);
                  navigate({ to: "/flows/$flowId", params: { flowId: flow.id } });
                }}
                className="qf-card p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-brand" />
                  <span className="text-[13.5px] font-medium">{t.name}</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{t.description}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t.questions} questions · {t.rules} rules
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}