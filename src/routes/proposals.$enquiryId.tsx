import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { ProposalDocument, proposalTemplates } from "@/components/quoteflow/ProposalDocument";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { runEngine } from "@/lib/quoteflow/engine";
import type { ProposalTemplateId } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, Send } from "lucide-react";

export const Route = createFileRoute("/proposals/$enquiryId")({
  head: () => ({
    meta: [
      { title: "Proposal — QuoteFlow" },
      { name: "description", content: "A premium, customer-ready proposal generated from the enquiry and your pricing logic." },
      { property: "og:title", content: "Proposal — QuoteFlow" },
      { property: "og:description", content: "A premium, customer-ready proposal generated from the enquiry and your pricing logic." },
    ],
  }),
  component: ProposalPage,
});

function ProposalPage() {
  const { enquiryId } = Route.useParams();
  const ws = useWorkspace();
  const { upsertProposal, upsertFlow } = useActions();

  const enquiry = ws.enquiries.find((e) => e.id === enquiryId);
  const flow = enquiry ? ws.flows.find((f) => f.id === enquiry.flowId) : undefined;
  const proposal = ws.proposals.find((p) => p.enquiryId === enquiryId);

  if (!enquiry || !flow) {
    return (
      <AppShell>
        <div className="p-10 text-center text-[13.5px] text-muted-foreground">
          Proposal not found.{" "}
          <Link to="/proposals" className="text-brand hover:underline">
            All proposals
          </Link>
        </div>
      </AppShell>
    );
  }

  const result = runEngine({
    flow,
    answers: enquiry.answers,
    products: ws.products,
    packages: ws.packages,
    selectedAddons: enquiry.selectedAddons,
  });
  const basePackage = ws.packages.find((p) => p.id === flow.basePackageId);
  const template = flow.settings.proposalTemplate;
  const inReview = proposal?.status === "review";

  return (
    <AppShell>
      <PageHeader
        title={proposal?.title ?? `${enquiry.business} — proposal`}
        description={`Prepared for ${enquiry.customer} · ${enquiry.email}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {proposal && <StatusPill status={proposal.status} />}
            <Select
              value={template}
              onValueChange={(v) =>
                upsertFlow({ ...flow, settings: { ...flow.settings, proposalTemplate: v as ProposalTemplateId } })
              }
            >
              <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {proposalTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} template
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm">
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
            <Button
              size="sm"
              onClick={() => proposal && upsertProposal({ ...proposal, status: "sent" })}
              disabled={proposal?.status === "sent" || proposal?.status === "accepted"}
            >
              <Send className="mr-1 h-4 w-4" />
              {proposal?.status === "sent" ? "Sent" : inReview ? "Approve & send" : "Send to customer"}
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <Link
          to="/enquiries/$enquiryId"
          params={{ enquiryId: enquiry.id }}
          className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to enquiry
        </Link>

        {inReview && (
          <div className="mx-auto mb-4 max-w-3xl rounded-lg border border-border bg-muted/50 px-4 py-3 text-[13px]">
            This flow holds proposals for internal review before sending. Approve it above when you're happy.
          </div>
        )}

        <ProposalDocument
          template={template}
          enquiry={enquiry}
          flow={flow}
          result={result}
          basePackage={basePackage}
          proposal={proposal}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => proposal && upsertProposal({ ...proposal, status: "accepted" })}
                disabled={proposal?.status === "accepted"}
              >
                {proposal?.status === "accepted" ? "Accepted" : "Accept proposal"}
              </Button>
              <Button variant="outline">Request a change</Button>
              <p className="text-[12px] text-muted-foreground">Valid for 14 days · 25% deposit secures your date.</p>
            </div>
          }
        />
      </div>
    </AppShell>
  );
}
