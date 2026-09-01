import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Logo } from "@/components/quoteflow/AppShell";
import { money } from "@/lib/quoteflow/engine";
import type { EngineResult } from "@/lib/quoteflow/engine";
import type { Enquiry, Flow, Package, Proposal, ProposalTemplateId } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const proposalTemplates: { id: ProposalTemplateId; name: string; blurb: string }[] = [
  { id: "ink", name: "Ink", blurb: "Dark cover band, premium and confident." },
  { id: "minimal", name: "Minimal", blurb: "Light, typographic, generous whitespace." },
  { id: "editorial", name: "Editorial", blurb: "Serif display headings with a two-column intro." },
  { id: "compact", name: "Compact", blurb: "Single page, table-forward, quick approvals." },
];

export interface ProposalDocProps {
  template: ProposalTemplateId;
  enquiry: Enquiry;
  flow: Flow;
  result: EngineResult;
  basePackage?: Package | undefined;
  proposal?: Proposal | undefined;
  actions?: ReactNode;
}

const ref = (p?: Proposal) => `#${(p?.id ?? "draft").slice(-6).toUpperCase()}`;
const dated = (p?: Proposal) => p?.createdAt ?? new Date().toISOString().slice(0, 10);

function LineTable({ result, dense }: { result: EngineResult; dense?: boolean }) {
  return (
    <div>
      <table className="w-full text-[13.5px]">
        <tbody>
          {result.lines.map((l) => (
            <tr key={l.id} className="border-b border-border last:border-0">
              <td className={cn("py-2.5", dense && "py-1.5")}>
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
  );
}

function Answers({ enquiry, flow }: { enquiry: Enquiry; flow: Flow }) {
  const label = (k: string) =>
    [...(flow.contactFields ?? []), ...flow.components].find((c) => c.variable === k)?.label ?? k;
  return (
    <dl className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
      {Object.entries(enquiry.answers).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-border/60 py-1 last:border-0">
          <dt className="text-muted-foreground">{label(k)}</dt>
          <dd className="font-medium">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProposalDocument(props: ProposalDocProps) {
  switch (props.template) {
    case "minimal":
      return <MinimalTemplate {...props} />;
    case "editorial":
      return <EditorialTemplate {...props} />;
    case "compact":
      return <CompactTemplate {...props} />;
    default:
      return <InkTemplate {...props} />;
  }
}

function InkTemplate({ enquiry, flow, result, basePackage, proposal, actions }: ProposalDocProps) {
  return (
    <article className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="bg-ink px-10 py-9 text-ink-foreground">
        <div className="flex items-start justify-between">
          <Logo className="text-ink-foreground" />
          <div className="text-right text-[12px] opacity-80">
            <p>Proposal {ref(proposal)}</p>
            <p>{dated(proposal)}</p>
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
          Thank you for your enquiry. Based on the details you shared, we've put together the package below. Everything
          here is tailored to your requirements and holds for 14 days.
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
          <div className="mt-2">
            <LineTable result={result} />
          </div>
        </div>
        <div className="mt-8 rounded-lg bg-muted/60 p-5">
          <p className="qf-label">Your details</p>
          <div className="mt-2">
            <Answers enquiry={enquiry} flow={flow} />
          </div>
        </div>
        {actions && <div className="mt-8 border-t border-border pt-6">{actions}</div>}
      </section>
      <footer className="border-t border-border px-10 py-5 text-[11.5px] text-muted-foreground">
        Prepared with QuoteFlow · hello@quoteflow.app
      </footer>
    </article>
  );
}

function MinimalTemplate({ enquiry, flow, result, basePackage, proposal, actions }: ProposalDocProps) {
  return (
    <article className="mx-auto max-w-2xl bg-card px-10 py-14">
      <div className="flex items-baseline justify-between border-b border-border pb-6">
        <Logo />
        <span className="text-[11.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {ref(proposal)} · {dated(proposal)}
        </span>
      </div>
      <h1 className="mt-12 text-[30px] font-semibold leading-tight tracking-tight">
        Quote for {enquiry.customer}
      </h1>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        {basePackage?.name ?? enquiry.business}
        {enquiry.eventDate ? ` · ${enquiry.eventDate}` : ""}
      </p>

      <div className="mt-12">
        <p className="qf-label">Quote</p>
        <div className="mt-3">
          <LineTable result={result} dense />
        </div>
      </div>

      {basePackage && (
        <div className="mt-12">
          <p className="qf-label">Included</p>
          <ul className="mt-3 space-y-1.5">
            {basePackage.includes.map((i) => (
              <li key={i} className="border-b border-border/60 pb-1.5 text-[13.5px] last:border-0">
                {i}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-12">
        <p className="qf-label">Brief</p>
        <div className="mt-3">
          <Answers enquiry={enquiry} flow={flow} />
        </div>
      </div>

      {actions && <div className="mt-12 border-t border-border pt-8">{actions}</div>}
    </article>
  );
}

function EditorialTemplate({ enquiry, flow, result, basePackage, proposal, actions }: ProposalDocProps) {
  return (
    <article className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-brand-soft px-10 py-12">
        <p className="text-[11.5px] uppercase tracking-[0.22em] text-brand">Proposal {ref(proposal)}</p>
        <h1 className="qf-serif mt-4 text-[42px] leading-[1.05]">
          {basePackage?.name ?? "A quote made for you"}
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground">
          Prepared for {enquiry.customer} · {dated(proposal)}
        </p>
      </div>
      <section className="grid gap-8 px-10 py-10 sm:grid-cols-2">
        <div>
          <p className="qf-label">The brief</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {enquiry.business}
            {enquiry.eventDate ? `, ${enquiry.eventDate}` : ""}
            {enquiry.location ? `, ${enquiry.location}` : ""}. Here is everything we'd bring, priced from the answers
            you gave us.
          </p>
        </div>
        <div>
          <p className="qf-label">Included</p>
          <ul className="mt-2 space-y-1">
            {(basePackage?.includes ?? []).map((i) => (
              <li key={i} className="flex items-start gap-2 text-[13.5px]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {i}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="border-t border-border px-10 py-10">
        <p className="qf-label">Investment</p>
        <div className="mt-3">
          <LineTable result={result} />
        </div>
        <div className="mt-10">
          <p className="qf-label">Your answers</p>
          <div className="mt-2">
            <Answers enquiry={enquiry} flow={flow} />
          </div>
        </div>
        {actions && <div className="mt-10 border-t border-border pt-6">{actions}</div>}
      </section>
    </article>
  );
}

function CompactTemplate({ enquiry, flow, result, proposal, actions }: ProposalDocProps) {
  return (
    <article className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-7">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div>
          <p className="text-[15px] font-semibold">Quote for {enquiry.customer}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {enquiry.business} · {enquiry.email}
          </p>
        </div>
        <span className="text-[11.5px] text-muted-foreground">
          {ref(proposal)} · {dated(proposal)}
        </span>
      </div>
      <div className="mt-5">
        <LineTable result={result} dense />
      </div>
      <details className="mt-5 rounded-md bg-muted/50 p-4">
        <summary className="cursor-pointer text-[13px] font-medium">Details you gave us</summary>
        <div className="mt-3">
          <Answers enquiry={enquiry} flow={flow} />
        </div>
      </details>
      {actions ? (
        <div className="mt-5 border-t border-border pt-4">{actions}</div>
      ) : (
        <Button className="mt-5 w-full">Accept quote</Button>
      )}
    </article>
  );
}
