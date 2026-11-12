import { useMemo, useRef, useState } from "react";
import type { Enquiry, Flow, FlowComponent, Package, Product, Proposal } from "@/lib/quoteflow/types";
import {
  createProposalSnapshot,
  createQuoteSnapshot,
  getEffectiveAnswers,
  money,
  runEngine,
} from "@/lib/quoteflow/engine";
import type { Answers } from "@/lib/quoteflow/engine";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { uid } from "@/lib/quoteflow/seed";
import { sanitizeProductQuantities, validateFlowField } from "@/lib/quoteflow/form-builder-adapter";
import { submitCustomerEnquiryServerFn } from "@/lib/quoteflow/server-fns";
import { FormSurface } from "@devcode-tech/gamiflow-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Check, Minus, Package as PackageIcon, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FlowPreviewProps {
  flow: Flow;
  products?: Product[] | undefined;
  packages?: Package[] | undefined;
  initialAnswers?: Answers | undefined;
  initialSelectedAddons?: string[] | undefined;
  initialSelectedProducts?: string[] | undefined;
  initialProductQuantities?: Record<string, number> | undefined;
  /** When true, a submission is stored in the local workspace as a real enquiry */
  record?: boolean | undefined;
  /** Optional validated parent origin for iframe postMessage communication */
  parentOrigin?: string | undefined;
  /** Optional callback fired when a submission completes */
  onSubmitted?: ((payload: { enquiry?: Enquiry | undefined; proposal?: Proposal | undefined; total: number }) => void) | undefined;
}

export function FlowPreview({
  flow,
  products: customProducts,
  packages: customPackages,
  initialAnswers,
  initialSelectedAddons,
  initialSelectedProducts,
  initialProductQuantities,
  record = false,
  parentOrigin,
  onSubmitted,
}: FlowPreviewProps) {
  const ws = useWorkspace();
  const { recordSubmission } = useActions();

  const products = customProducts ?? ws.products;
  const packages = customPackages ?? ws.packages;
  const idempotencyKeyRef = useRef<string>(`idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  // Retained draft answers across steps and visibility changes
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [selectedAddons, setSelectedAddons] = useState<string[]>(initialSelectedAddons ?? []);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(initialSelectedProducts ?? []);
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>(
    initialProductQuantities ?? {},
  );
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submittedTotal, setSubmittedTotal] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Synchronous idempotency guard against rapid double-click submissions
  const isSubmittingRef = useRef(false);

  const settings = flow.settings;
  const basePackage = useMemo(
    () => ws.packages.find((p) => p.id === flow.basePackageId && !p.archived),
    [ws.packages, flow.basePackageId],
  );

  // First pass evaluates rules and recommendations from current draft answers
  const prelimResult = useMemo(
    () =>
      runEngine({
        flow,
        answers,
        products: ws.products,
        packages: ws.packages,
        selectedAddons,
        selectedProducts,
        productQuantities,
      }),
    [flow, answers, ws.products, ws.packages, selectedAddons, selectedProducts, productQuantities],
  );

  // Filter customer-selected products to only those currently eligible (recommended & active)
  const eligibleRecommendedIds = useMemo(
    () => new Set(prelimResult.recommendedProducts.map((p) => p.id)),
    [prelimResult.recommendedProducts],
  );

  const effectiveSelectedProducts = useMemo(
    () => selectedProducts.filter((id) => eligibleRecommendedIds.has(id)),
    [selectedProducts, eligibleRecommendedIds],
  );

  const effectiveQuantities = useMemo(
    () => sanitizeProductQuantities(productQuantities, new Set(effectiveSelectedProducts)),
    [productQuantities, effectiveSelectedProducts],
  );

  // Authoritative engine result using eligible selections and sanitized quantities
  const result = useMemo(
    () =>
      runEngine({
        flow,
        answers,
        products: ws.products,
        packages: ws.packages,
        selectedAddons,
        selectedProducts: effectiveSelectedProducts,
        productQuantities: effectiveQuantities,
      }),
    [flow, answers, ws.products, ws.packages, selectedAddons, effectiveSelectedProducts, effectiveQuantities],
  );

  const visible = (c: FlowComponent) => !result.hiddenComponentIds.includes(c.id);
  const contactFields = (flow.contactFields ?? []).filter(visible);
  const questions = flow.components.filter(
    (c) =>
      Boolean(c.variable) &&
      visible(c) &&
      c.type !== "calculation" &&
      c.type !== "variable" &&
      c.type !== "price-summary" &&
      c.type !== "recommendation" &&
      c.type !== "proposal" &&
      c.type !== "crm-action",
  );
  const showPrice = settings.showPriceSummary && flow.components.some((c) => c.type === "price-summary");
  const hasBlockingEngineError = result.errors.length > 0 || !result.converged;

  const setAnswer = (variable: string, value: Answers[string], compId?: string) => {
    setAnswers((a) => ({ ...a, [variable]: value }));
    setSubmissionError(null);
    setFieldErrors((prev) => {
      const copy = { ...prev };
      delete copy[variable];
      if (compId) delete copy[compId];
      return copy;
    });
  };

  const toggleAddon = (addonId: string) => {
    setSelectedAddons((prev) =>
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId],
    );
  };

  const toggleRecommendedProduct = (productId: string) => {
    setSelectedProducts((prev) => {
      const isSelected = prev.includes(productId);
      if (isSelected) {
        return prev.filter((id) => id !== productId);
      }
      setProductQuantities((q) => ({ ...q, [productId]: q[productId] && q[productId]! >= 1 ? q[productId]! : 1 }));
      return [...prev, productId];
    });
  };

  const updateProductQuantity = (productId: string, rawQty: number) => {
    if (!Number.isFinite(rawQty)) return;
    const clamped = Math.floor(rawQty);
    if (clamped <= 0) {
      // Zero quantity removes selection cleanly
      setSelectedProducts((prev) => prev.filter((id) => id !== productId));
      setProductQuantities((prev) => {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      });
      return;
    }
    const safeQty = Math.min(9999, clamped);
    setProductQuantities((prev) => ({ ...prev, [productId]: safeQty }));
    setSelectedProducts((prev) => (prev.includes(productId) ? prev : [...prev, productId]));
  };

  /**
   * Validates all visible fields (contact + questions) in a single unified pass,
   * ensuring errors on earlier steps are never overwritten or masked.
   */
  const validateAllVisibleFields = (): {
    contactErrors: Record<string, string>;
    questionErrors: Record<string, string>;
    isValid: boolean;
  } => {
    const contactErrors: Record<string, string> = {};
    for (const f of contactFields) {
      if (!f.variable) continue;
      const val = answers[f.variable];
      const err = validateFlowField(f, val);
      if (err) contactErrors[f.id] = err;
    }

    const questionErrors: Record<string, string> = {};
    for (const f of questions) {
      if (!f.variable) continue;
      const val = answers[f.variable];
      const err = validateFlowField(f, val);
      if (err) questionErrors[f.id] = err;
    }

    const allErrors = { ...contactErrors, ...questionErrors };
    setFieldErrors(allErrors);
    return {
      contactErrors,
      questionErrors,
      isValid: Object.keys(allErrors).length === 0,
    };
  };

  const validateContactFieldsOnly = (): boolean => {
    const contactErrors: Record<string, string> = {};
    for (const f of contactFields) {
      if (!f.variable) continue;
      const val = answers[f.variable];
      const err = validateFlowField(f, val);
      if (err) contactErrors[f.id] = err;
    }
    setFieldErrors((prev) => ({ ...prev, ...contactErrors }));
    return Object.keys(contactErrors).length === 0;
  };

  const submit = async () => {
    if (isSubmittingRef.current || submitted) return;
    setSubmissionError(null);

    // Validate ALL currently visible fields (contact and question fields)
    const { contactErrors, isValid } = validateAllVisibleFields();
    if (!isValid) {
      if (Object.keys(contactErrors).length > 0) {
        setStep(0); // Jump back to step 0 if contact info is invalid
      }
      return;
    }

    if (hasBlockingEngineError) {
      setSubmissionError(
        result.errors[0] ?? "Unable to finalize quote due to a configuration error in this flow.",
      );
      return;
    }

    isSubmittingRef.current = true;

    try {
      // Exclude hidden question answers from the persisted effective answers map
      const effectiveAnswersMap = getEffectiveAnswers(flow, answers, result.hiddenComponentIds);
      const answerRecord = Object.fromEntries(
        Object.entries(effectiveAnswersMap).filter(([, v]) => v !== undefined && v !== ""),
      ) as Record<string, string | number | string[]>;

      const validAddonIds = basePackage
        ? selectedAddons.filter((id) => basePackage.addons.some((a) => a.id === id))
        : [];

      const finalizedQuoteSnapshot = createQuoteSnapshot(flow, result);
      let createdEnquiry: Enquiry | undefined;
      let createdProposal: Proposal | undefined;

      if (record) {
        const enquiryId = uid("en");
        const newEnquiry: Enquiry = {
          id: enquiryId,
          customer: String(effectiveAnswersMap["contact_name"] ?? "Website visitor").trim() || "Website visitor",
          email: String(effectiveAnswersMap["contact_email"] ?? "").trim(),
          business: String(effectiveAnswersMap["contact_company"] ?? flow.name).trim() || flow.name,
          flowId: flow.id,
          status: "new",
          createdAt: new Date().toISOString().slice(0, 10),
          ...(effectiveAnswersMap["event_date"]
            ? { eventDate: String(effectiveAnswersMap["event_date"]) }
            : {}),
          ...(effectiveAnswersMap["location"]
            ? { location: String(effectiveAnswersMap["location"]) }
            : {}),
          answers: answerRecord,
          selectedAddons: validAddonIds,
          selectedProducts: effectiveSelectedProducts,
          quoteConfig: {
            basePackageId: flow.basePackageId,
            selectedAddonIds: validAddonIds,
            selectedProductIds: effectiveSelectedProducts,
            productQuantities: effectiveQuantities,
            manualAdjustments: [],
          },
          quoteSnapshot: finalizedQuoteSnapshot,
          notes: "Submitted through the customer flow.",
        };

        createdEnquiry = newEnquiry;

        if (flow.submission.generateProposal === "on_submit") {
          const proposalSnapshot = createProposalSnapshot({
            enquiry: newEnquiry,
            flow,
            result,
            ws,
            revision: 1,
          });
          const newProposal: Proposal = {
            id: uid("pr"),
            enquiryId,
            status: "review", // Held in internal review pending actual external delivery
            createdAt: new Date().toISOString().slice(0, 10),
            title: `${newEnquiry.business} — proposal`,
            snapshot: proposalSnapshot,
            revision: 1,
          };
          createdProposal = newProposal;
        }

        // Server-authoritative submission to shared SQLite database
        try {
          await submitCustomerEnquiryServerFn({
            data: {
              flowId: flow.id,
              answers: answerRecord,
              selectedAddons: validAddonIds,
              selectedProducts: effectiveSelectedProducts,
              productQuantities: effectiveQuantities,
              idempotencyKey: idempotencyKeyRef.current,
            },
          });
        } catch (serverErr) {
          console.warn("[QuoteFlow Submission] Server submission fallback:", serverErr);
        }

        // Atomic storage update: verifies localStorage write BEFORE committing in-memory state
        recordSubmission({
          enquiry: newEnquiry,
          proposal: createdProposal,
          flowId: flow.id,
        });
      }

      // Safe, restricted postMessage: only send minimal notification to same-origin parent
      if (typeof window !== "undefined" && window.parent !== window) {
        try {
          const targetOrigin =
            parentOrigin && (parentOrigin === window.location.origin)
              ? parentOrigin
              : window.location.origin;

          window.parent.postMessage(
            {
              type: "quoteflow:submit",
              flowId: flow.id,
              payload: {
                enquiryId: createdEnquiry?.id,
                total: finalizedQuoteSnapshot.total,
              },
            },
            targetOrigin,
          );
        } catch (e) {
          console.warn("Restricted postMessage to same-origin:", e);
        }
      }

      setSubmittedTotal(finalizedQuoteSnapshot.total);
      setSubmitted(true);
      onSubmitted?.({
        enquiry: createdEnquiry,
        proposal: createdProposal,
        total: finalizedQuoteSnapshot.total,
      });
    } catch (err) {
      console.error("[QuoteFlow Submission] Failed to finalize submission:", err);
      setSubmissionError("We couldn't save your quote locally. Please check your browser storage settings and try again.");
      isSubmittingRef.current = false;
    }
  };

  if (submitted) {
    const finalDisplayTotal = submittedTotal ?? result.total;
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="submission-success">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand">
          <Check className="h-5 w-5" />
        </span>
        <h2 className="mt-4 font-serif text-3xl">Thank you — we're on it.</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">
          {settings.thankYouMessage}
          {showPrice ? ` Your indicative quote is ${money(finalDisplayTotal)}.` : ""}
        </p>
        {!record && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Preview mode: No enquiry or proposal record was created in your workspace.
          </p>
        )}
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            isSubmittingRef.current = false;
            setSubmitted(false);
            setSubmittedTotal(null);
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
    <FormSurface className="w-full bg-transparent p-0">
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
                errorMessage={fieldErrors[c.id]}
                onChange={(v) => setAnswer(c.variable!, v, c.id)}
              />
            ))}
            {stepFields.length === 0 && (
              <p className="text-[13.5px] text-muted-foreground">No questions on this step yet.</p>
            )}
          </div>

          {/* Optional Package Add-ons on Step 1 */}
          {step === 1 && basePackage && basePackage.addons.length > 0 && (
            <div className="mt-8 border-t border-border pt-6" data-testid="package-addons-section">
              <div className="flex items-center gap-2">
                <PackageIcon className="h-4 w-4 text-brand" />
                <h2 className="text-[14.5px] font-semibold">Optional package add-ons</h2>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Enhance your {basePackage.name} with any of these optional extras.
              </p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {basePackage.addons.map((addon) => {
                  const isChecked = selectedAddons.includes(addon.id);
                  return (
                    <label
                      key={addon.id}
                      data-testid={`addon-card-${addon.id}`}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-[13.5px] transition-colors hover:border-brand/50",
                        isChecked && "border-brand bg-brand-soft/30",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleAddon(addon.id)}
                          aria-label={`Select add-on ${addon.name}`}
                        />
                        <span className="font-medium">{addon.name}</span>
                      </span>
                      <span className="font-medium tabular-nums text-muted-foreground">
                        +{money(addon.price)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {hasBlockingEngineError && (
            <div
              role="alert"
              data-testid="engine-blocking-error"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-[13px] text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Quote calculation error</p>
                <p className="mt-0.5 text-[12.5px]">
                  {result.errors[0] ?? "This flow contains a circular dependency or invalid calculation."}
                </p>
              </div>
            </div>
          )}

          {submissionError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive"
            >
              {submissionError}
            </div>
          )}

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
                  if (validateContactFieldsOnly()) {
                    setFieldErrors({});
                    setStep(1);
                  }
                }}
              >
                Continue
              </Button>
            ) : (
              <Button
                className="h-11 sm:px-10"
                disabled={hasBlockingEngineError}
                onClick={submit}
                data-testid="submit-quote-button"
              >
                {settings.submitLabel}
              </Button>
            )}
          </div>
        </div>

        {showPrice && step === 1 && (
          <aside className="h-fit space-y-4 lg:sticky lg:top-8">
            {settings.showRecommendations && result.recommendedProducts.length > 0 && (
              <div className="qf-card p-4" data-testid="recommendations-panel">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-brand" /> Recommended for your event
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Suggested based on your answers. Select any item to include it in your quote.
                </p>
                <ul className="mt-3 space-y-2.5">
                  {result.recommendedProducts.map((p) => {
                    const isSelected = effectiveSelectedProducts.includes(p.id);
                    const qty = effectiveQuantities[p.id] ?? 1;
                    return (
                      <RecommendationCard
                        key={p.id}
                        product={p}
                        selected={isSelected}
                        quantity={qty}
                        onToggle={() => toggleRecommendedProduct(p.id)}
                        onQuantityChange={(nextQty) => updateProductQuantity(p.id, nextQty)}
                      />
                    );
                  })}
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
    </FormSurface>
  );
}

function RecommendationCard({
  product,
  selected,
  quantity,
  onToggle,
  onQuantityChange,
}: {
  product: Product;
  selected: boolean;
  quantity: number;
  onToggle: () => void;
  onQuantityChange: (qty: number) => void;
}) {
  return (
    <li
      data-testid={`recommendation-item-${product.id}`}
      className={cn(
        "rounded-lg border border-border bg-card p-3 transition-colors",
        selected && "border-brand bg-brand-soft/30",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-0.5"
            aria-label={`Select recommended product ${product.name}`}
          />
          <div>
            <span className="font-medium text-foreground">{product.name}</span>
            {product.description && (
              <span className="block text-[12px] text-muted-foreground">{product.description}</span>
            )}
            <span className="mt-0.5 inline-block text-[11.5px] font-medium text-brand">
              {money(product.price)} {product.unit !== "flat" ? `(${product.unit})` : ""}
            </span>
          </div>
        </label>
        <Button
          type="button"
          size="sm"
          variant={selected ? "secondary" : "outline"}
          className="h-7 shrink-0 px-2.5 text-[11.5px]"
          onClick={onToggle}
          data-testid={`toggle-rec-${product.id}`}
        >
          {selected ? "Selected" : "Add"}
        </Button>
      </div>

      {selected && (
        <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 text-[12px]">
          <span className="text-muted-foreground">Quantity</span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label={`Decrease quantity for ${product.name}`}
              data-testid={`dec-qty-${product.id}`}
              onClick={() => onQuantityChange(quantity - 1)}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Input
              type="number"
              min={1}
              max={9999}
              aria-label={`Quantity for ${product.name}`}
              data-testid={`input-qty-${product.id}`}
              className="h-7 w-16 bg-card px-2 text-center text-[12.5px] tabular-nums"
              value={quantity}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                onQuantityChange(Number(raw));
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label={`Increase quantity for ${product.name}`}
              data-testid={`inc-qty-${product.id}`}
              onClick={() => onQuantityChange(quantity + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </li>
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
  errorMessage,
  onChange,
}: {
  component: FlowComponent;
  value: Answers[string];
  errorMessage?: string | undefined;
  onChange: (v: Answers[string]) => void;
}) {
  const isInvalid = Boolean(errorMessage);
  const inputId = `qf-field-${c.id}`;
  const errorId = `qf-error-${c.id}`;

  return (
    <div>
      <label htmlFor={inputId} className="block text-[14px] font-medium">
        {c.label}
        {c.required && <span className="ml-1 text-brand">*</span>}
      </label>
      {c.description && <p className="mb-2 mt-0.5 text-[12.5px] text-muted-foreground">{c.description}</p>}
      {c.type === "dropdown" || c.type === "radio" ? (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
          <SelectTrigger
            id={inputId}
            aria-invalid={isInvalid}
            aria-describedby={isInvalid ? errorId : undefined}
            className={cn("mt-1 h-11 bg-card", isInvalid && "border-destructive")}
          >
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
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={inputId}>
          {(c.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? value : [];
            const checked = arr.includes(o.value);
            return (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13.5px]",
                  checked && "border-brand bg-brand-soft/20",
                  isInvalid && "border-destructive",
                )}
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
            id={inputId}
            aria-invalid={isInvalid}
            aria-describedby={isInvalid ? errorId : undefined}
            className={cn("h-11 bg-card", isInvalid && "border-destructive")}
            type={
              c.type === "number"
                ? "number"
                : c.type === "date"
                  ? "date"
                  : c.type === "email"
                    ? "email"
                    : c.type === "phone"
                      ? "tel"
                      : "text"
            }
            value={value === undefined ? "" : String(value)}
            min={c.min}
            max={c.max}
            onChange={(e) => {
              const raw = e.target.value;
              if (c.type === "number") {
                onChange(raw === "" ? undefined : Number(raw));
              } else {
                onChange(raw);
              }
            }}
          />
          {c.unit && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-muted-foreground">
              {c.unit}
            </span>
          )}
        </div>
      )}
      {errorMessage && (
        <p id={errorId} role="alert" className="mt-1 text-[12px] text-destructive">
          {errorMessage}
        </p>
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
  hideEmptyNote,
}: {
  lines: {
    id: string;
    label: string;
    detail?: string | undefined;
    amount: number;
    quantity?: number | undefined;
    unitPrice?: number | undefined;
  }[];
  subtotal: number;
  discount: number;
  total: number;
  title?: string;
  hideEmptyNote?: boolean;
}) {
  return (
    <div className="qf-card p-4" data-testid="price-summary-card">
      <p className="qf-label">{title}</p>
      <ul className="mt-3 space-y-2 text-[13.5px]">
        {lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <span>{l.label}</span>
              {l.quantity !== undefined && l.quantity > 1 && l.unitPrice !== undefined && (
                <span className="ml-1.5 text-[11.5px] text-muted-foreground">
                  ({l.quantity} × {money(l.unitPrice)})
                </span>
              )}
            </div>
            <span className="shrink-0 tabular-nums text-muted-foreground">{money(l.amount)}</span>
          </li>
        ))}
        {lines.length === 0 && !hideEmptyNote && (
          <li className="text-muted-foreground">Answer a few questions to see pricing.</li>
        )}
      </ul>
      <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[13.5px]">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums" data-testid="quote-subtotal">
            {money(subtotal)}
          </span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount</span>
            <span className="tabular-nums" data-testid="quote-discount">
              -{money(discount)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-2 text-[15px] font-semibold">
          <span>Total</span>
          <span className="tabular-nums" data-testid="quote-total">
            {money(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
