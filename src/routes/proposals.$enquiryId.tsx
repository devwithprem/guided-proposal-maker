import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { ProposalDocument, proposalTemplates } from "@/components/quoteflow/ProposalDocument";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { evaluateEnquiryQuote } from "@/lib/quoteflow/engine";
import type { EngineResult } from "@/lib/quoteflow/engine";
import type { Package, ProposalTemplateId } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Check, Download, Send } from "lucide-react";

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

  const liveOrEnquiryResult = evaluateEnquiryQuote(enquiry, ws);
  const result: EngineResult = proposal?.snapshot
    ? {
        matchedRules: liveOrEnquiryResult?.matchedRules ?? [],
        messages: liveOrEnquiryResult?.messages ?? [],
        recommendedProducts: liveOrEnquiryResult?.recommendedProducts ?? [],
        lines: proposal.snapshot.quote.lines.map((l) => ({ ...l })),
        subtotal: proposal.snapshot.quote.subtotal,
        discount: proposal.snapshot.quote.discount,
        total: proposal.snapshot.quote.total,
        score: proposal.snapshot.quote.score,
        hiddenComponentIds: liveOrEnquiryResult?.hiddenComponentIds ?? [],
        calculations: proposal.snapshot.quote.calculations.map((c) => ({ ...c })),
        errors: [],
        converged: true,
        resolvedAnswers: { ...enquiry.answers },
      }
    : liveOrEnquiryResult!;

  const basePackage: Package | undefined = proposal?.snapshot?.basePackage
    ? {
        ...proposal.snapshot.basePackage,
        addons: [],
        archived: false,
      }
    : ws.packages.find((p) => p.id === flow.basePackageId);

  const template = proposal?.snapshot?.template ?? flow.settings.proposalTemplate;
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
              onValueChange={(v) => {
                const nextTemplate = v as ProposalTemplateId;
                upsertFlow({ ...flow, settings: { ...flow.settings, proposalTemplate: nextTemplate } });
                if (proposal?.snapshot) {
                  upsertProposal({
                    ...proposal,
                    snapshot: { ...proposal.snapshot, template: nextTemplate },
                  });
                }
              }}
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
            <Button variant="outline" size="sm" onClick={() => typeof window !== "undefined" && window.print()}>
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
            {inReview && proposal && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => upsertProposal({ ...proposal, status: "draft" })}
              >
                <Check className="mr-1 h-4 w-4 text-brand" /> Approve for sending
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Automated email delivery requires connecting an outbound mail provider (future milestone). Status is kept in internal review/draft."
            >
              <Send className="mr-1 h-4 w-4" />
              Send (Email provider required)
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
            This proposal is held for internal review. Click &quot;Approve for sending&quot; when you are ready.
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
                variant="outline"
                disabled
                title="Verified customer acceptance requires the customer-facing proposal link."
              >
                Acceptance (Customer action required)
              </Button>
              <Button variant="outline" onClick={() => typeof window !== "undefined" && window.print()}>
                Print / Save PDF
              </Button>
              <p className="text-[12px] text-muted-foreground">Valid for 14 days · 25% deposit secures your date.</p>
            </div>
          }
        />
      </div>
    </AppShell>
  );
}
