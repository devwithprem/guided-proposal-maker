import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getPublicProposalByTokenServerFn, respondToPublicProposalServerFn } from "@/lib/quoteflow/server-fns";
import type { PublicProposalView } from "@/lib/quoteflow/types";
import { money } from "@/lib/quoteflow/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  MapPin,
  MessageSquare,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/p/$token")({
  head: () => ({
    meta: [
      { title: "Review Your Quotation — QuoteFlow" },
      { name: "description", content: "Review and respond to your event proposal and quote." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async ({ params }): Promise<{ proposal: PublicProposalView | null; error: string | null }> => {
    try {
      const proposal = await getPublicProposalByTokenServerFn({ data: { token: params.token } });
      return { proposal, error: null };
    } catch (err) {
      return { proposal: null, error: (err as Error).message || "Proposal could not be loaded." };
    }
  },
  component: PublicProposalPage,
});

function PublicProposalPage() {
  const { token } = Route.useParams();
  const loaderData = Route.useLoaderData();

  const [proposal, setProposal] = useState<PublicProposalView | null>(loaderData.proposal);
  const [errorMessage, setErrorMessage] = useState<string | null>(loaderData.error);

  // Interaction modal/form states
  const [activeModal, setActiveModal] = useState<"accept" | "changes" | "decline" | null>(null);
  const [customerNameInput, setCustomerNameInput] = useState(loaderData.proposal?.customerName || "");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (errorMessage || !proposal) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6 text-center">
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-serif text-2xl font-semibold">Unable to Load Proposal</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {errorMessage || "This proposal link is either invalid, expired, or currently under review."}
          </p>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            If you believe this is an error, please reach out directly to the event provider.
          </p>
        </div>
      </div>
    );
  }

  const handleActionSubmit = async () => {
    if (!activeModal) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (activeModal === "accept") {
        if (!customerNameInput.trim()) {
          setActionError("Please enter your name to confirm acceptance.");
          setIsSubmitting(false);
          return;
        }
        await respondToPublicProposalServerFn({
          data: {
            token,
            action: "accept",
            customerName: customerNameInput.trim(),
          },
        });
        setProposal((prev) =>
          prev
            ? {
                ...prev,
                status: "accepted",
                canRespond: false,
                acceptedByName: customerNameInput.trim(),
                respondedAt: new Date().toISOString(),
              }
            : null,
        );
        setActiveModal(null);
      } else if (activeModal === "changes") {
        if (!feedbackNote.trim()) {
          setActionError("Please describe the adjustments you would like to request.");
          setIsSubmitting(false);
          return;
        }
        await respondToPublicProposalServerFn({
          data: {
            token,
            action: "request_changes",
            note: feedbackNote.trim(),
          },
        });
        setProposal((prev) =>
          prev
            ? {
                ...prev,
                status: "changes_requested",
                canRespond: false,
                customerResponseNote: feedbackNote.trim(),
                respondedAt: new Date().toISOString(),
              }
            : null,
        );
        setActiveModal(null);
      } else if (activeModal === "decline") {
        await respondToPublicProposalServerFn({
          data: {
            token,
            action: "decline",
            note: feedbackNote.trim() || undefined,
          },
        });
        setProposal((prev) =>
          prev
            ? {
                ...prev,
                status: "declined",
                canRespond: false,
                customerResponseNote: feedbackNote.trim() || undefined,
                respondedAt: new Date().toISOString(),
              }
            : null,
        );
        setActiveModal(null);
      }
    } catch (err) {
      setActionError((err as Error).message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const depositPercent = proposal.depositPercent || 25;
  const depositAmount = Math.round(((proposal.quote.total * depositPercent) / 100) * 100) / 100;

  return (
    <div className="min-h-screen bg-slate-50/60 text-foreground dark:bg-slate-950">
      {/* Top Banner for Customer Actions */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 px-6 py-3.5 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground text-[14px] font-bold">
              Q
            </span>
            <div>
              <p className="text-[13px] font-semibold">{proposal.businessName}</p>
              <p className="text-[11.5px] text-muted-foreground">Proposal {proposal.title}</p>
            </div>
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Rev {proposal.revision}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => typeof window !== "undefined" && window.print()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Print / PDF
            </Button>

            {proposal.canRespond && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActionError(null);
                    setActiveModal("changes");
                  }}
                >
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Request changes
                </Button>
                <Button
                  size="sm"
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                  onClick={() => {
                    setActionError(null);
                    setActiveModal("accept");
                  }}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Accept proposal
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Proposal Container */}
      <main className="mx-auto max-w-4xl px-5 py-8">
        {/* Status Notification Alerts */}
        {proposal.status === "accepted" && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-[13.5px] text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-semibold">Proposal Accepted</p>
              <p className="mt-0.5 text-[12.5px] opacity-90">
                Accepted by <span className="font-medium">{proposal.acceptedByName || proposal.customerName}</span>
                {proposal.respondedAt ? ` on ${new Date(proposal.respondedAt).toLocaleDateString()}` : ""}.
                A representative from {proposal.businessName} will follow up with deposit and contract details.
              </p>
            </div>
          </div>
        )}

        {proposal.status === "changes_requested" && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-[13.5px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">Changes Requested</p>
              <p className="mt-0.5 text-[12.5px] opacity-90">
                Your requested adjustments have been submitted: &quot;{proposal.customerResponseNote}&quot;.
                The team is preparing an updated revision for your review.
              </p>
            </div>
          </div>
        )}

        {proposal.status === "declined" && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-50 p-4 text-[13.5px] text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="font-semibold">Proposal Declined</p>
              <p className="mt-0.5 text-[12.5px] opacity-90">
                This proposal has been marked as declined. Please get in touch if you would like to revisit options.
              </p>
            </div>
          </div>
        )}

        {/* Paper Document Card */}
        <article className="rounded-xl border border-border bg-card p-8 shadow-sm sm:p-12">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-8">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-brand">Quotation</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                {proposal.title}
              </h1>
              <p className="mt-2 text-[14px] text-muted-foreground">
                Prepared for <span className="font-medium text-foreground">{proposal.customerName}</span> ({proposal.customerEmail})
              </p>
            </div>

            <div className="text-right text-[13px] text-muted-foreground sm:text-right">
              <p className="font-semibold text-foreground">{proposal.businessName}</p>
              {proposal.eventDate && (
                <p className="mt-1 flex items-center justify-end gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> {proposal.eventDate}
                </p>
              )}
              {proposal.location && (
                <p className="mt-0.5 flex items-center justify-end gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {proposal.location}
                </p>
              )}
            </div>
          </div>

          {/* Proposal Notes from Business */}
          {proposal.proposalNotes && (
            <div className="mt-6 rounded-lg border border-brand/20 bg-brand-soft/20 p-4 text-[13.5px]">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-brand">A note from our team</p>
              <p className="mt-1 text-foreground/90 whitespace-pre-line">{proposal.proposalNotes}</p>
            </div>
          )}

          {/* Line Items Table */}
          <section className="mt-8">
            <h2 className="text-[14px] font-semibold uppercase tracking-wider text-muted-foreground">
              Itemised Pricing
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-border text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5">Item</th>
                    <th className="py-2.5 text-center">Qty</th>
                    <th className="py-2.5 text-right">Unit Price</th>
                    <th className="py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {proposal.quote.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-3">
                        <span className="font-medium text-foreground">{line.label}</span>
                        {line.detail && (
                          <span className="block text-[12px] text-muted-foreground">{line.detail}</span>
                        )}
                      </td>
                      <td className="py-3 text-center tabular-nums text-muted-foreground">
                        {line.quantity ?? 1}
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {line.unitPrice !== undefined ? money(line.unitPrice) : money(line.amount)}
                      </td>
                      <td className="py-3 text-right font-medium tabular-nums text-foreground">
                        {money(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="mt-6 ml-auto max-w-xs space-y-2 border-t border-border pt-4 text-[13.5px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(proposal.quote.subtotal)}</span>
              </div>
              {proposal.quote.discount > 0 && (
                <div className="flex justify-between text-brand">
                  <span>Discount</span>
                  <span className="tabular-nums">-{money(proposal.quote.discount)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-2 text-[19px] font-semibold text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{money(proposal.quote.total)}</span>
              </div>
              <div className="flex justify-between text-[12.5px] text-muted-foreground">
                <span>Deposit required ({depositPercent}%)</span>
                <span className="tabular-nums font-medium text-foreground">{money(depositAmount)}</span>
              </div>
            </div>
          </section>

          {/* Terms & Conditions */}
          {proposal.terms && (
            <section className="mt-10 border-t border-border pt-6 text-[12.5px] text-muted-foreground">
              <h3 className="font-semibold text-foreground">Terms & Conditions</h3>
              <p className="mt-2 whitespace-pre-line leading-relaxed">{proposal.terms}</p>
            </section>
          )}

          {/* Expiration Note */}
          <footer className="mt-8 flex items-center justify-between border-t border-border pt-4 text-[11.5px] text-muted-foreground">
            <span>
              Quotation Revision {proposal.revision} · QuoteFlow Secure Token Authentication
            </span>
            {proposal.expiresAt && (
              <span>Valid until {new Date(proposal.expiresAt).toLocaleDateString()}</span>
            )}
          </footer>
        </article>

        {/* Floating Customer Action Banner when canRespond */}
        {proposal.canRespond && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand/30 bg-card p-6 shadow-md">
            <div>
              <h3 className="text-[15px] font-semibold">Ready to move forward?</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Accepting locks in pricing and secures your date with a {depositPercent}% deposit.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setActionError(null);
                  setActiveModal("decline");
                }}
              >
                Decline
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setActiveModal("changes");
                }}
              >
                Request changes
              </Button>
              <Button
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={() => {
                  setActionError(null);
                  setActiveModal("accept");
                }}
              >
                <Check className="mr-1.5 h-4 w-4" /> Accept proposal
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Modal / Dialog for Customer Acceptance */}
      {activeModal === "accept" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="font-serif text-xl font-semibold">Accept Proposal</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Please enter your full name below to confirm acceptance of this quote ({money(proposal.quote.total)}).
            </p>

            <div className="mt-4">
              <label className="text-[12.5px] font-medium text-foreground">Full name</label>
              <Input
                className="mt-1"
                value={customerNameInput}
                onChange={(e) => setCustomerNameInput(e.target.value)}
                placeholder="Your full legal name"
              />
            </div>

            {actionError && (
              <p className="mt-3 text-[12.5px] font-medium text-destructive">{actionError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => setActiveModal(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSubmitting}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={handleActionSubmit}
              >
                {isSubmitting ? "Confirming…" : "Confirm Acceptance"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Dialog for Requesting Changes */}
      {activeModal === "changes" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="font-serif text-xl font-semibold">Request Modifications</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Let us know what you would like adjusted (items, quantities, dates, or budget).
            </p>

            <div className="mt-4">
              <label className="text-[12.5px] font-medium text-foreground">Requested changes</label>
              <Textarea
                className="mt-1 min-h-[100px]"
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                placeholder="E.g. We would like to add 2 patio heaters and reduce chair count to 150."
              />
            </div>

            {actionError && (
              <p className="mt-3 text-[12.5px] font-medium text-destructive">{actionError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => setActiveModal(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSubmitting}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={handleActionSubmit}
              >
                {isSubmitting ? "Submitting…" : "Send Request"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Dialog for Declining */}
      {activeModal === "decline" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="font-serif text-xl font-semibold">Decline Proposal</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Are you sure you want to decline this proposal? You may optionally include feedback for the team.
            </p>

            <div className="mt-4">
              <label className="text-[12.5px] font-medium text-foreground">Feedback (optional)</label>
              <Textarea
                className="mt-1 min-h-[80px]"
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                placeholder="Reason for declining…"
              />
            </div>

            {actionError && (
              <p className="mt-3 text-[12.5px] font-medium text-destructive">{actionError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => setActiveModal(null)}
              >
                Keep Proposal Open
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isSubmitting}
                onClick={handleActionSubmit}
              >
                {isSubmitting ? "Declining…" : "Confirm Decline"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
