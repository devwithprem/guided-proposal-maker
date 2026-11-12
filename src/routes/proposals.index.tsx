import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { useWorkspace } from "@/lib/quoteflow/store";
import { getProposalTotal, money } from "@/lib/quoteflow/engine";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/proposals/")({
  head: () => ({
    meta: [
      { title: "Proposals — QuoteFlow" },
      { name: "description", content: "Every proposal generated from an enquiry, with status and value at a glance." },
      { property: "og:title", content: "Proposals — QuoteFlow" },
      { property: "og:description", content: "Every proposal generated from an enquiry, with status and value at a glance." },
    ],
  }),
  component: ProposalsPage,
});

function ProposalsPage() {
  const ws = useWorkspace();

  const rows = ws.proposals.map((p) => {
    const enquiry = ws.enquiries.find((e) => e.id === p.enquiryId);
    const total = getProposalTotal(p, ws);
    return { proposal: p, enquiry, total };
  });

  return (
    <AppShell>
      <PageHeader title="Proposals" description="Polished, customer-ready documents generated from your quotes." />
      <div className="p-6">
        <div className="qf-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Proposal</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Value</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ proposal, enquiry, total }) => (
                <tr key={proposal.id} className="border-b border-border/70 last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {proposal.title}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {proposal.snapshot?.customer ?? enquiry?.customer ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{proposal.createdAt}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={proposal.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(total)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {enquiry && (
                      <Link
                        to="/proposals/$enquiryId"
                        params={{ enquiryId: enquiry.id }}
                        className="text-[12.5px] font-medium text-brand hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                    No proposals yet — open an enquiry and generate one.
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
