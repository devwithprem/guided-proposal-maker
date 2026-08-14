import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { useWorkspace } from "@/lib/quoteflow/store";
import { money, runEngine } from "@/lib/quoteflow/engine";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — QuoteFlow" },
      { name: "description", content: "Track enquiries, quotes and proposals in one workspace." },
      { property: "og:title", content: "QuoteFlow Dashboard" },
      { property: "og:description", content: "Track enquiries, quotes and proposals in one workspace." },
    ],
  }),
  component: Dashboard,
});

function Metric({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="qf-card p-4">
      <p className="qf-label">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5 text-brand" />
        {delta}
      </p>
    </div>
  );
}

function Dashboard() {
  const ws = useWorkspace();

  const valueOf = (enquiryId: string) => {
    const enq = ws.enquiries.find((e) => e.id === enquiryId)!;
    const flow = ws.flows.find((f) => f.id === enq.flowId);
    if (!flow) return 0;
    return runEngine({
      flow,
      answers: enq.answers,
      products: ws.products,
      packages: ws.packages,
      selectedAddons: enq.selectedAddons,
    }).total;
  };

  const quotes = ws.enquiries.filter((e) => e.status !== "new").length;
  const sent = ws.proposals.filter((p) => p.status !== "draft").length;
  const conversion = ws.enquiries.length ? Math.round((sent / ws.enquiries.length) * 100) : 0;

  return (
    <AppShell>
      <PageHeader
        title="Turn enquiries into quotes in minutes."
        description="Collect requirements, apply your business rules, configure the right solution and send a proposal."
        actions={
          <Button asChild size="sm">
            <Link to="/flows">Open flows</Link>
          </Button>
        }
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="New Enquiries" value={String(ws.enquiries.filter((e) => e.status === "new").length)} delta="+2 this week" />
          <Metric label="Quotes Created" value={String(quotes)} delta="+3 this week" />
          <Metric label="Proposals Sent" value={String(sent)} delta="+1 this week" />
          <Metric label="Conversion Rate" value={`${conversion}%`} delta="Up 4 pts vs last month" />
        </div>

        <section className="qf-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[14px] font-semibold">Recent Enquiries</h2>
            <span className="text-[12px] text-muted-foreground">{ws.enquiries.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {["Customer", "Business", "Flow", "Status", "Estimated Value", "Created", "Action"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 text-[11px] font-semibold uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ws.enquiries.map((e) => (
                  <tr key={e.id} className="border-b border-border/70 last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{e.customer}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{e.business}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {ws.flows.find((f) => f.id === e.flowId)?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={e.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">{money(valueOf(e.id))}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{e.createdAt}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
                          <Link to="/enquiries/$enquiryId" params={{ enquiryId: e.id }}>
                            View
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
                          <Link to="/flows/$flowId" params={{ flowId: e.flowId }}>
                            Configure
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm" className="h-7 px-2 text-[12px]">
                          <Link to="/proposals/$enquiryId" params={{ enquiryId: e.id }}>
                            Create Proposal <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/"!</div>
}
