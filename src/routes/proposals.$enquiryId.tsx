import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { ProposalDocument, proposalTemplates } from "@/components/quoteflow/ProposalDocument";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { evaluateEnquiryQuote } from "@/lib/quoteflow/engine";
import type { EngineResult } from "@/lib/quoteflow/engine";
import type { Package, ProposalTemplateId } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  History,
  Sparkles,
  XCircle,
} from "lucide-react";
import { approveAndIssueProposalServerFn } from "@/lib/quoteflow/server-fns";

export const Route = createFileRoute("/proposals/$enquiryId")({
  head: () => ({
    meta: [
      { title: "Proposal — QuoteFlow" },
      {
        name: "description",
        content: "A premium, customer-ready proposal generated from the enquiry and your pricing logic.",
      },
    ],
  }),
  component: ProposalPage,
});

function ProposalPage() {
  const { enquiryId } = Route.useParams();
  const ws = useWorkspace();
  const { upsertProposal, upsertFlow } = useActions();

  const [isIssuing, setIsIssuing] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  const inReview = proposal?.status === "review" || proposal?.status === "draft";
  const isApproved = proposal?.status === "approved" || proposal?.status === "sent";

  const handleApproveAndIssue = async () => {
    setIsIssuing(true);
    try {
      const res = await approveAndIssueProposalServerFn({
        data: {
          enquiryId: enquiry.id,
        },
      });
      if (res?.shareUrl) {
        setIssuedUrl(res.shareUrl);
        upsertProposal(res.proposal);
      }
    } catch (err) {
      console.error("Failed to approve proposal:", err);
      alert((err as Error).message || "Failed to issue proposal");
    } finally {
      setIsIssuing(false);
    }
  };

  const copyLink = () => {
    if (!issuedUrl) return;
    const full = `${window.location.origin}${issuedUrl}`;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell>
      <PageHeader
        title={proposal?.title ?? `${enquiry.business} — proposal`}
        description={`Prepared for ${enquiry.customer} · ${enquiry.email} · Revision ${proposal?.revision ?? 1}`}
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
            <Button
              size="sm"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={isIssuing}
              onClick={handleApproveAndIssue}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              {isIssuing
                ? "Issuing…"
                : inReview
                  ? "Approve & Issue to Customer"
                  : `Issue Rev ${(proposal?.revision ?? 1) + 1}`}
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
          <ArrowLeft className="h-3.5 w-3.5" /> Back to enquiry & quote configurator
        </Link>

        {/* Customer Access Link Banner */}
        {issuedUrl && (
          <div className="mx-auto mb-6 max-w-3xl rounded-xl border border-brand/40 bg-brand-soft/30 p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-semibold text-foreground">
                  Proposal Issued (Revision {proposal?.revision ?? 1})
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  Secure customer quotation link generated:
                </p>
                <code className="mt-1.5 block rounded bg-card px-2.5 py-1 text-[12px] font-mono select-all">
                  {typeof window !== "undefined" ? window.location.origin : ""}{issuedUrl}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyLink}>
                  {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-brand" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy Customer Link"}
                </Button>
                <Button size="sm" asChild>
                  <a href={issuedUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Customer Status Banners */}
        {proposal?.status === "accepted" && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-[13px] text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-semibold">Customer Accepted Proposal</p>
              <p className="mt-0.5 opacity-90">
                Accepted by {proposal.acceptedByName || enquiry.customer}
                {proposal.respondedAt ? ` on ${new Date(proposal.respondedAt).toLocaleDateString()}` : ""}.
              </p>
            </div>
          </div>
        )}

        {proposal?.status === "changes_requested" && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-[13px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">Customer Requested Changes</p>
              <p className="mt-0.5 opacity-90">
                Customer Note: &quot;{proposal.customerResponseNote}&quot;
              </p>
              <Link
                to="/enquiries/$enquiryId"
                params={{ enquiryId: enquiry.id }}
                className="mt-2 inline-flex items-center gap-1 font-semibold text-brand hover:underline"
              >
                Open Quote Configurator to adjust & issue next revision →
              </Link>
            </div>
          </div>
        )}

        {proposal?.status === "declined" && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-50 p-4 text-[13px] text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="font-semibold">Proposal Declined by Customer</p>
              {proposal.customerResponseNote && (
                <p className="mt-0.5 opacity-90">Reason: {proposal.customerResponseNote}</p>
              )}
            </div>
          </div>
        )}

        {/* In Review Warning */}
        {inReview && !issuedUrl && (
          <div className="mx-auto mb-6 max-w-3xl rounded-lg border border-border bg-muted/50 px-4 py-3 text-[13px]">
            This proposal is currently held in internal review. Click &quot;Approve & Issue to Customer&quot; above to create a secure customer quotation link.
          </div>
        )}

        {/* Revision History Panel */}
        {proposal?.revisionHistory && proposal.revisionHistory.length > 0 && (
          <div className="mx-auto mb-6 max-w-3xl rounded-lg border border-border bg-card p-4 text-[12.5px]">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <History className="h-4 w-4 text-brand" /> Revision History
            </div>
            <div className="mt-2 divide-y divide-border">
              {proposal.revisionHistory.map((rev) => (
                <div key={rev.revision} className="flex items-center justify-between py-1.5 text-muted-foreground">
                  <span>Revision {rev.revision} · {new Date(rev.capturedAt).toLocaleDateString()}</span>
                  <span className="font-medium text-foreground">{rev.quote.total.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
                </div>
              ))}
            </div>
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
              <Button variant="outline" onClick={() => typeof window !== "undefined" && window.print()}>
                Print / Save PDF
              </Button>
              <p className="text-[12px] text-muted-foreground">
                Revision {proposal?.revision ?? 1} · Valid for 14 days · 25% deposit secures your date.
              </p>
            </div>
          }
        />
      </div>
    </AppShell>
  );
}
