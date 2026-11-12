import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { createProposalSnapshot, evaluateEnquiryQuote, money } from "@/lib/quoteflow/engine";
import { PriceSummary } from "@/components/quoteflow/FlowPreview";
import { uid } from "@/lib/quoteflow/seed";
import type { EnquiryStatus } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarDays, FileText, Mail, MapPin, Sparkles } from "lucide-react";

export const Route = createFileRoute("/enquiries/$enquiryId")({
  head: () => ({
    meta: [
      { title: "Enquiry — QuoteFlow" },
      { name: "description", content: "Review a customer enquiry, the answers they gave and the quote your logic produced." },
      { property: "og:title", content: "Enquiry — QuoteFlow" },
      { property: "og:description", content: "Review a customer enquiry, the answers they gave and the quote your logic produced." },
    ],
  }),
  component: EnquiryDetail,
});

const statuses: EnquiryStatus[] = ["new", "qualified", "quoted", "won", "lost"];

function EnquiryDetail() {
  const { enquiryId } = Route.useParams();
  const ws = useWorkspace();
  const { upsertEnquiry, upsertProposal } = useActions();
  const navigate = useNavigate();

  const enquiry = ws.enquiries.find((e) => e.id === enquiryId);
  if (!enquiry) {
    return (
      <AppShell>
        <div className="p-10 text-center text-[13.5px] text-muted-foreground">
          Enquiry not found.{" "}
          <Link to="/" className="text-brand hover:underline">
            Back to dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const flow = ws.flows.find((f) => f.id === enquiry.flowId);
  const result = evaluateEnquiryQuote(enquiry, ws);

  const labelFor = (variable: string) =>
    [...(flow?.contactFields ?? []), ...(flow?.components ?? [])].find((c) => c.variable === variable)?.label ??
    variable;

  return (
    <AppShell>
      <PageHeader
        title={enquiry.customer}
        description={`${enquiry.business} · submitted ${enquiry.createdAt} via ${flow?.name ?? "unknown flow"}`}
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={enquiry.status}
              onValueChange={(v) => upsertEnquiry({ ...enquiry, status: v as EnquiryStatus })}
            >
              <SelectTrigger className="h-8 w-[130px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => {
                const existing = ws.proposals.find((p) => p.enquiryId === enquiry.id);
                if (!existing && flow && result) {
                  const snapshot = createProposalSnapshot({
                    enquiry,
                    flow,
                    result,
                    ws,
                    revision: 1,
                  });
                  upsertProposal({
                    id: uid("pr"),
                    enquiryId: enquiry.id,
                    status: "draft",
                    createdAt: new Date().toISOString().slice(0, 10),
                    title: `${enquiry.business} — proposal`,
                    snapshot,
                    revision: 1,
                  });
                }
                navigate({ to: "/proposals/$enquiryId", params: { enquiryId: enquiry.id } });
              }}
            >
              <Sparkles className="mr-1 h-4 w-4" /> Generate proposal
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All enquiries
        </Link>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <div className="qf-card p-4">
              <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {enquiry.email}
                </span>
                {enquiry.eventDate && (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" /> {enquiry.eventDate}
                  </span>
                )}
                {enquiry.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {enquiry.location}
                  </span>
                )}
                <StatusPill status={enquiry.status} />
              </div>
            </div>

            <div className="qf-card">
              <div className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Answers</div>
              <dl className="divide-y divide-border">
                {Object.entries(enquiry.answers).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-6 px-4 py-2.5">
                    <dt className="text-[13px] text-muted-foreground">
                      {labelFor(k)}
                      <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{k}</code>
                    </dt>
                    <dd className="text-right text-[13.5px] font-medium">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {result && (
              <div className="qf-card">
                <div className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">
                  Logic trace · {result.matchedRules.length} rule{result.matchedRules.length === 1 ? "" : "s"} fired
                </div>
                <ul className="divide-y divide-border">
                  {result.calculations.map((c) => (
                    <li key={c.variable} className="flex justify-between px-4 py-2 text-[12.5px]">
                      <span className="text-muted-foreground">{c.name}</span>
                      <code className="font-mono text-[11.5px]">
                        {c.variable} = {c.value}
                      </code>
                    </li>
                  ))}
                  {result.messages.map((m, i) => (
                    <li key={i} className="px-4 py-2 text-[12.5px] text-muted-foreground">
                      {m}
                    </li>
                  ))}
                  {result.messages.length === 0 && (
                    <li className="px-4 py-4 text-center text-[12.5px] text-muted-foreground">No rules matched.</li>
                  )}
                </ul>
              </div>
            )}

            <div className="qf-card p-4">
              <p className="qf-label mb-2">Internal notes</p>
              <Textarea
                value={enquiry.notes}
                onChange={(e) => upsertEnquiry({ ...enquiry, notes: e.target.value })}
                placeholder="Context for your team…"
              />
            </div>
          </div>

          <div className="space-y-4">
            {result && (
              <PriceSummary
                lines={result.lines}
                subtotal={result.subtotal}
                discount={result.discount}
                total={result.total}
                title={enquiry.quoteSnapshot ? "Submitted quote snapshot" : "Calculated quote"}
              />
            )}
            <div className="qf-card p-4">
              <p className="qf-label">Lead score</p>
              <p className="mt-1 text-[26px] font-semibold tabular-nums">{result?.score ?? 0}</p>
              <p className="text-[12.5px] text-muted-foreground">
                Driven by scoring rules in {flow?.name ?? "the flow"}.
              </p>
            </div>
            <Link
              to="/proposals/$enquiryId"
              params={{ enquiryId: enquiry.id }}
              className="qf-card flex items-center gap-2 p-4 text-[13px] font-medium hover:border-brand/40"
            >
              <FileText className="h-4 w-4 text-brand" />
              View proposal · {money(result?.total ?? 0)}
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
