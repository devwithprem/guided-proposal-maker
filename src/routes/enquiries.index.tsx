import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { useWorkspace } from "@/lib/quoteflow/store";
import { getEnquiryTotal, money } from "@/lib/quoteflow/engine";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export const Route = createFileRoute("/enquiries/")({
  head: () => ({
    meta: [
      { title: "Enquiries — QuoteFlow" },
      { name: "description", content: "Every customer submission that came through your flows, with its quote value and status." },
      { property: "og:title", content: "Enquiries — QuoteFlow" },
      { property: "og:description", content: "Every customer submission that came through your flows, with its quote value and status." },
    ],
  }),
  component: EnquiriesPage,
});

function EnquiriesPage() {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [flowId, setFlowId] = useState("all");

  const rows = ws.enquiries
    .filter((e) => (status === "all" ? true : e.status === status))
    .filter((e) => (flowId === "all" ? true : e.flowId === flowId))
    .filter((e) =>
      q.trim() === ""
        ? true
        : `${e.customer} ${e.email} ${e.business}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .map((e) => {
      const flow = ws.flows.find((f) => f.id === e.flowId);
      const value = getEnquiryTotal(e, ws);
      return { e, flow, value };
    });

  return (
    <AppShell>
      <PageHeader
        title="Enquiries"
        description="Every submission your flows have collected — this is where customer entries live."
      />
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="Search name, email or business"
              className="h-9 w-[260px] pl-8 text-[13px]"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[140px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "new", "qualified", "quoted", "won", "lost"].map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s === "all" ? "All statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={flowId} onValueChange={setFlowId}>
            <SelectTrigger className="h-9 w-[200px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flows</SelectItem>
              {ws.flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[12.5px] text-muted-foreground">{rows.length} entries</span>
        </div>

        <div className="qf-card overflow-hidden">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Flow</th>
                <th className="px-4 py-2.5 font-medium">Received</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Quote value</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, flow, value }) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className="font-medium">{e.customer}</span>
                    <span className="block text-[12px] text-muted-foreground">{e.email}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{flow?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.createdAt}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(value)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="outline" className="h-7 text-[12px]">
                      <Link to="/enquiries/$enquiryId" params={{ enquiryId: e.id }}>
                        Open
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                    No enquiries match those filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
