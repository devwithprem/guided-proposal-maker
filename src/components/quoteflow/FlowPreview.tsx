import { useMemo, useState } from "react";
import type { Flow, FlowComponent } from "@/lib/quoteflow/types";
import { money, runEngine } from "@/lib/quoteflow/engine";
import type { Answers } from "@/lib/quoteflow/engine";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { uid } from "@/lib/quoteflow/seed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function FlowPreview({
  flow,
  initialAnswers,
  record = false,
}: {
  flow: Flow;
  initialAnswers?: Answers;
  /** when true, a submission is stored as a real enquiry */
  record?: boolean;
}) {
  const ws = useWorkspace();
  const { upsertEnquiry, upsertProposal, upsertFlow } = useActions();
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const settings = flow.settings;

  const result = useMemo(
    () => runEngine({ flow, answers, products: ws.products, packages: ws.packages }),
    [flow, answers, ws.products, ws.packages],
  );

  const visible = (c: FlowComponent) => !result.hiddenComponentIds.includes(c.id);
  const contactFields = (flow.contactFields ?? []).filter(visible);
  const questions = flow.components.filter((c) => c.variable && visible(c) && c.type !== "calculation");
  const showPrice = settings.showPriceSummary && flow.components.some((c) => c.type === "price-summary");

  const set = (variable: string, value: Answers[string]) => setAnswers((a) => ({ ...a, [variable]: value }));

  const validate = (fields: FlowComponent[]) => {
    const missing = fields
      .filter((f) => f.required)
      .filter((f) => {
        const v = answers[f.variable!];
        return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      })
      .map((f) => f.id);
    setErrors(missing);
    return missing.length === 0;
  };

  const submit = () => {
    if (!validate(questions)) return;
    if (record) {
      const enquiryId = uid("en");
      const answerRecord = Object.fromEntries(
        Object.entries(answers).filter(([, v]) => v !== undefined),
      ) as Record<string, string | number | string[]>;
      upsertEnquiry({
        id: enquiryId,
        customer: String(answers["contact_name"] ?? "Website visitor"),
        email: String(answers["contact_email"] ?? ""),
        business: String(answers["contact_company"] ?? flow.name),
        flowId: flow.id,
        status: "new",
        createdAt: new Date().toISOString().slice(0, 10),
        eventDate: answers["event_date"] ? String(answers["event_date"]) : undefined,
        location: answers["location"] ? String(answers["location"]) : undefined,
        answers: answerRecord,
        selectedAddons: [],
        notes: "Submitted through the customer flow.",
      });
      if (flow.submission.generateProposal === "on_submit") {
        upsertProposal({
          id: uid("pr"),
          enquiryId,
          status: flow.submission.delivery === "immediate" ? "sent" : "review",
          createdAt: new Date().toISOString().slice(0, 10),
          title: `${flow.name} — proposal`,
        });
      }
      upsertFlow({ ...flow, submissions: flow.submissions + 1 });
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <span className="grid mx-auto h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand">
          <Check className="h-5 w-5" />
        </span>
        <h2 className="mt-4 font-serif text-3xl">Thank you — we're on it.</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">
          {settings.thankYouMessage}
          {showPrice ? ` Your indicative quote is ${money(result.total)}.` : ""}
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            setSubmitted(false);
            setStep(0);
          }}
        >
          Back to the form
        </Button>
      </div>
    );
  }

  const stepFields = step === 0 ? contactFields : questions;

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <Stepper step={step} />
        <h1 className="mt-5 font-serif text-4xl leading-tight">
          {step === 0 ? settings.headline : "A few details about the job."}
        </h1>
        <p className="mt-2 max-w-md text-[14.5px] text-muted-foreground">
          {step === 0 ? settings.subheadline : "Your answers shape the recommendation and the price below."}
        </p>

        <div className="mt-8 space-y-6">
          {stepFields.map((c) => (
            <FieldRenderer
              key={c.id}
              component={c}
              value={answers[c.variable!]}
              invalid={errors.includes(c.id)}
              onChange={(v) => set(c.variable!, v)}
            />
          ))}
          {stepFields.length === 0 && (
            <p className="text-[13.5px] text-muted-foreground">No questions on this step yet.</p>
          )}
        </div>

        <div className="mt-8 flex items-center gap-2">
          {step === 1 && (
            <Button variant="outline" className="h-11" onClick={() => setStep(0)}>
              Back
            </Button>
          )}
          {step === 0 ? (
            <Button
              className="h-11 sm:px-10"
              onClick={() => {
                if (validate(contactFields)) {
                  setErrors([]);
                  setStep(1);
                }
              }}
            >
              Continue
            </Button>
          ) : (
            <Button className="h-11 sm:px-10" onClick={submit}>
              {settings.submitLabel}
            </Button>
          )}
        </div>
      </div>

      {showPrice && step === 1 && (
        <aside className="h-fit lg:sticky lg:top-8">
          {settings.showRecommendations && result.recommendedProducts.length > 0 && (
            <div className="qf-card mb-3 p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <Sparkles className="h-3.5 w-3.5 text-brand" /> Recommended for you
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
                {result.recommendedProducts.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                    <span>
                      <span className="text-foreground">{p.name}</span> — {p.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <PriceSummary
            lines={settings.breakdown === "itemised" ? result.lines : []}
            subtotal={result.subtotal}
            discount={result.discount}
            total={result.total}
            hideEmptyNote={settings.breakdown !== "itemised"}
          />
        </aside>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Your details", "About the job"];
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full text-[11.5px] font-semibold",
              i <= step ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span className={cn("text-[12.5px]", i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
          {i === 0 && <span className="h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function FieldRenderer({
  component: c,
  value,
  invalid,
  onChange,
}: {
  component: FlowComponent;
  value: Answers[string];
  invalid?: boolean;
  onChange: (v: Answers[string]) => void;
}) {
  return (
    <div>
      <label className="block text-[14px] font-medium">
        {c.label}
        {c.required && <span className="ml-1 text-brand">*</span>}
      </label>
      {c.description && <p className="mb-2 mt-0.5 text-[12.5px] text-muted-foreground">{c.description}</p>}
      {c.type === "dropdown" || c.type === "radio" ? (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className={cn("mt-1 h-11 bg-card", invalid && "border-destructive")}>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {(c.options ?? []).map((o) => (
              <SelectItem key={o.id} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : c.type === "multiselect" || c.type === "checkbox" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {(c.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? value : [];
            const checked = arr.includes(o.value);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13.5px]"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => onChange(v ? [...arr, o.value] : arr.filter((x) => x !== o.value))}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : (
        <div className="relative mt-1">
          <Input
            className={cn("h-11 bg-card", invalid && "border-destructive")}
            type={
              c.type === "number" ? "number" : c.type === "date" ? "date" : c.type === "email" ? "email" : c.type === "phone" ? "tel" : "text"
            }
            value={String(value ?? "")}
            min={c.min}
            max={c.max}
            onChange={(e) => onChange(c.type === "number" ? Number(e.target.value) : e.target.value)}
          />
          {c.unit && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-muted-foreground">
              {c.unit}
            </span>
          )}
        </div>
      )}
      {invalid && <p className="mt-1 text-[12px] text-destructive">This one's required.</p>}
    </div>
  );
}

export function PriceSummary({
  lines,
  subtotal,
  discount,
  total,
  title = "Your estimate",
  hideEmptyNote,
}: {
  lines: { id: string; label: string; detail?: string; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  title?: string;
  hideEmptyNote?: boolean;
}) {
  return (
    <div className="qf-card p-4">
      <p className="qf-label">{title}</p>
      <ul className="mt-3 space-y-2 text-[13.5px]">
        {lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-4">
            <span>{l.label}</span>
            <span className="tabular-nums text-muted-foreground">{money(l.amount)}</span>
          </li>
        ))}
        {lines.length === 0 && !hideEmptyNote && (
          <li className="text-muted-foreground">Answer a few questions to see pricing.</li>
        )}
      </ul>
      <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[13.5px]">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{money(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount</span>
            <span className="tabular-nums">-{money(discount)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-2 text-[15px] font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}
