import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Logo, PageHeader } from "@/components/quoteflow/AppShell";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { money, runEngine } from "@/lib/quoteflow/engine";
import { Button } from "@/components/ui/button";
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
  const { upsertProposal } = useActions();

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

  return (
    <AppShell>
      <PageHeader
        title={proposal?.title ?? `${enquiry.business} — proposal`}
        description={`Prepared for ${enquiry.customer} · ${enquiry.email}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
            <Button
              size="sm"
              onClick={() => proposal && upsertProposal({ ...proposal, status: "sent" })}
              disabled={proposal?.status === "sent" || proposal?.status === "accepted"}
            >
              <Send className="mr-1 h-4 w-4" />
              {proposal?.status === "sent" ? "Sent" : "Send to customer"}
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

        {/* Customer-facing document */}
        <article className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <header className="bg-ink px-10 py-9 text-ink-foreground">
            <div className="flex items-start justify-between">
              <Logo className="text-ink-foreground" />
              <div className="text-right text-[12px] opacity-80">
                <p>Proposal #{(proposal?.id ?? "draft").slice(-6).toUpperCase()}</p>
                <p>{proposal?.createdAt ?? new Date().toISOString().slice(0, 10)}</p>
              </div>
            </div>
            <h1 className="qf-serif mt-8 text-[34px] leading-tight">
              {basePackage?.name ?? "Your custom quote"} for {enquiry.customer}
            </h1>
            <p className="mt-2 max-w-lg text-[13.5px] opacity-80">
              {enquiry.business}
              {enquiry.eventDate ? ` · ${enquiry.eventDate}` : ""}
              {enquiry.location ? ` · ${enquiry.location}` : ""}
            </p>
          </header>

          <section className="px-10 py-8">
            <p className="qf-label">Overview</p>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              Thank you for your enquiry. Based on the details you shared, we've put together the package below.
              Everything here is tailored to your requirements and holds for 14 days.
            </p>

            {basePackage && (
              <div className="mt-8">
                <p className="qf-label">What's included</p>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {basePackage.includes.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-[13.5px]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {i}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8">
              <p className="qf-label">Your quote</p>
              <table className="mt-2 w-full text-[13.5px]">
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="py-2.5">
                        <span className="font-medium">{l.label}</span>
                        {l.detail && <span className="block text-[12.5px] text-muted-foreground">{l.detail}</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13.5px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(result.subtotal)}</span>
                </div>
                {result.discount > 0 && (
                  <div className="flex justify-between text-brand">
                    <span>Discount</span>
                    <span className="tabular-nums">-{money(result.discount)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-border pt-3 text-[20px] font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{money(result.total)}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-lg bg-muted/60 p-5">
              <p className="qf-label">Your details</p>
              <dl className="mt-2 grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
                {Object.entries(enquiry.answers).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border/60 py-1 last:border-0">
                    <dt className="text-muted-foreground">
                      {flow.components.find((c) => c.variable === k)?.label ?? k}
                    </dt>
                    <dd className="font-medium">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6">
              <Button
                onClick={() => proposal && upsertProposal({ ...proposal, status: "accepted" })}
                disabled={proposal?.status === "accepted"}
              >
                {proposal?.status === "accepted" ? "Accepted" : "Accept proposal"}
              </Button>
              <Button variant="outline">Request a change</Button>
              <p className="text-[12px] text-muted-foreground">Valid for 14 days · 25% deposit secures your date.</p>
            </div>
          </section>

          <footer className="border-t border-border px-10 py-5 text-[11.5px] text-muted-foreground">
            Prepared with QuoteFlow · hello@quoteflow.app
          </footer>
        </article>
      </div>
    </AppShell>
  );
}
