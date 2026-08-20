import { useMemo, useState } from "react";
import type { Flow } from "@/lib/quoteflow/types";
import { money, runEngine } from "@/lib/quoteflow/engine";
import type { Answers } from "@/lib/quoteflow/engine";
import { useWorkspace } from "@/lib/quoteflow/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Sparkles } from "lucide-react";

export function FlowPreview({ flow, initialAnswers }: { flow: Flow; initialAnswers?: Answers }) {
  const ws = useWorkspace();
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo(
    () => runEngine({ flow, answers, products: ws.products, packages: ws.packages }),
    [flow, answers, ws.products, ws.packages],
  );

  const questions = flow.components.filter(
    (c) => c.variable && !result.hiddenComponentIds.includes(c.id) && c.type !== "calculation",
  );
  const showPrice = flow.components.some((c) => c.type === "price-summary");

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <span className="grid mx-auto h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand">
          <Check className="h-5 w-5" />
        </span>
        <h2 className="mt-4 font-serif text-3xl">Thank you — we're on it.</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">
          We've received your details and your indicative quote of {money(result.total)}. A proposal will land in your
          inbox shortly.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => setSubmitted(false)}>
          Back to the form
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <h1 className="font-serif text-4xl leading-tight">Let's plan your event.</h1>
        <p className="mt-2 max-w-md text-[14.5px] text-muted-foreground">
          Tell us a little about your event and we'll recommend the right package.
        </p>

        <div className="mt-8 space-y-6">
          {questions.map((c) => {
            const value = answers[c.variable!];
            return (
              <div key={c.id}>
                <label className="block text-[14px] font-medium">
                  {c.label}
                  {c.required && <span className="ml-1 text-brand">*</span>}
                </label>
                {c.description && <p className="mb-2 mt-0.5 text-[12.5px] text-muted-foreground">{c.description}</p>}
                {c.type === "dropdown" || c.type === "radio" ? (
                  <Select
                    value={String(value ?? "")}
                    onValueChange={(v) => setAnswers((a) => ({ ...a, [c.variable!]: v }))}
                  >
                    <SelectTrigger className="mt-1 h-11 bg-card">
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
                            onCheckedChange={(v) =>
                              setAnswers((a) => ({
                                ...a,
                                [c.variable!]: v ? [...arr, o.value] : arr.filter((x) => x !== o.value),
                              }))
                            }
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Input
                      className="h-11 bg-card"
                      type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                      value={String(value ?? "")}
                      min={c.min}
                      max={c.max}
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [c.variable!]: c.type === "number" ? Number(e.target.value) : e.target.value,
                        }))
                      }
                    />
                    {c.unit && (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-muted-foreground">
                        {c.unit}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button className="mt-8 h-11 w-full sm:w-auto sm:px-10" onClick={() => setSubmitted(true)}>
          Continue
        </Button>
      </div>

      {showPrice && (
        <aside className="h-fit lg:sticky lg:top-8">
          {result.recommendedProducts.length > 0 && (
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
          <PriceSummary lines={result.lines} subtotal={result.subtotal} discount={result.discount} total={result.total} />
        </aside>
      )}
    </div>
  );
}

export function PriceSummary({
  lines,
  subtotal,
  discount,
  total,
  title = "Your estimate",
}: {
  lines: { id: string; label: string; detail?: string; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  title?: string;
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
        {lines.length === 0 && <li className="text-muted-foreground">Answer a few questions to see pricing.</li>}
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