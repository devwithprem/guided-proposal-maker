import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader, StatusPill } from "@/components/quoteflow/AppShell";
import { syncFromServer, useActions, useWorkspace } from "@/lib/quoteflow/store";
import {
  evaluateEnquiryQuote,
  evaluateWorkingEnquiryQuote,
  money,
} from "@/lib/quoteflow/engine";
import { PriceSummary } from "@/components/quoteflow/FlowPreview";
import type { EnquiryQuoteConfig, EnquiryStatus, ManualQuoteAdjustment } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Minus,
  Package as PackageIcon,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  approveAndIssueProposalServerFn,
  saveEnquiryQuoteConfigServerFn,
} from "@/lib/quoteflow/server-fns";

export const Route = createFileRoute("/enquiries/$enquiryId")({
  head: () => ({
    meta: [
      { title: "Enquiry Review & Quote Configurator — QuoteFlow" },
      {
        name: "description",
        content: "Review customer quotation, configure working quote, and issue secure proposals.",
      },
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
  const flow = enquiry ? ws.flows.find((f) => f.id === enquiry.flowId) : undefined;

  // Local working state initialized from enquiry
  const [workingConfig, setWorkingConfig] = useState<EnquiryQuoteConfig>(() => ({
    basePackageId: enquiry?.quoteConfig?.basePackageId ?? flow?.basePackageId,
    selectedAddonIds: enquiry?.quoteConfig?.selectedAddonIds ?? enquiry?.selectedAddons ?? [],
    selectedProductIds: enquiry?.quoteConfig?.selectedProductIds ?? enquiry?.selectedProducts ?? [],
    productQuantities: enquiry?.quoteConfig?.productQuantities ?? {},
    manualAdjustments: enquiry?.quoteConfig?.manualAdjustments ?? [],
  }));

  const [notes, setNotes] = useState(enquiry?.notes ?? "");
  const [proposalNotes, setProposalNotes] = useState("");
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!enquiry || !flow) {
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

  // 1. Original submitted quote (immutable snapshot)
  const submittedResult = evaluateEnquiryQuote(enquiry, ws);

  // 2. Working quote evaluation
  const virtualEnquiry = {
    ...enquiry,
    quoteConfig: workingConfig,
    notes,
  };
  const workingResult = evaluateWorkingEnquiryQuote(virtualEnquiry, ws);

  const selectedBasePkg = ws.packages.find((p) => p.id === workingConfig.basePackageId);

  // Helper actions
  const handleSaveWorkingConfig = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await saveEnquiryQuoteConfigServerFn({
        data: {
          enquiryId: enquiry.id,
          quoteConfig: workingConfig,
          notes,
        },
      });
      upsertEnquiry({
        ...enquiry,
        quoteConfig: workingConfig,
        notes,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error("Failed to save working quote configuration:", err);
      alert((err as Error).message || "Failed to save working quote configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveAndIssue = async () => {
    setIsIssuing(true);
    try {
      const res = await approveAndIssueProposalServerFn({
        data: {
          enquiryId: enquiry.id,
          proposalNotes: proposalNotes.trim() || undefined,
        },
      });
      if (res?.shareUrl) {
        setIssuedUrl(res.shareUrl);
        upsertProposal(res.proposal);
        upsertEnquiry({
          ...enquiry,
          status: enquiry.status === "new" || enquiry.status === "qualified" ? "quoted" : enquiry.status,
          quoteConfig: workingConfig,
          notes,
        });
        syncFromServer();
      }
    } catch (err) {
      console.error("Failed to approve and issue proposal:", err);
      alert((err as Error).message || "Failed to issue proposal");
    } finally {
      setIsIssuing(false);
    }
  };

  const copyCustomerLink = () => {
    if (!issuedUrl) return;
    const full = `${window.location.origin}${issuedUrl}`;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const labelFor = (variable: string) =>
    [...(flow?.contactFields ?? []), ...(flow?.components ?? [])].find((c) => c.variable === variable)
      ?.label ?? variable;

  return (
    <AppShell>
      <PageHeader
        title={enquiry.customer}
        description={`${enquiry.business} · submitted ${enquiry.createdAt} via ${flow.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
              variant="outline"
              disabled={isSaving}
              onClick={handleSaveWorkingConfig}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saveSuccess ? "Saved!" : isSaving ? "Saving…" : "Save Working Quote"}
            </Button>

            <Button
              size="sm"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={isIssuing}
              onClick={handleApproveAndIssue}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {isIssuing ? "Issuing…" : "Approve & Issue Proposal"}
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All enquiries
        </Link>

        {/* Issued Proposal Customer Link Banner */}
        {issuedUrl && (
          <div className="mb-6 rounded-xl border border-brand/40 bg-brand-soft/30 p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-semibold text-foreground">
                  Proposal Approved & Issued!
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  The proposal has been published. Share this private access link directly with the customer:
                </p>
                <code className="mt-1.5 block rounded bg-card px-2.5 py-1 text-[12px] font-mono select-all">
                  {typeof window !== "undefined" ? window.location.origin : ""}{issuedUrl}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyCustomerLink}>
                  {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-brand" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy Customer Link"}
                </Button>
                <Button size="sm" asChild>
                  <a href={issuedUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open Proposal
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          {/* LEFT COLUMN: Customer Answers & Working Quote Configurator */}
          <div className="space-y-6">
            {/* Contact Details Card */}
            <div className="qf-card p-4">
              <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Mail className="h-3.5 w-3.5 text-brand" /> {enquiry.email}
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

            {/* WORKING QUOTE CONFIGURATOR */}
            <div className="qf-card p-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="text-[14.5px] font-semibold text-foreground">
                    Working Proposal Configuration
                  </h3>
                  <p className="text-[12px] text-muted-foreground">
                    Customize base package, add-ons, products, and adjustments for this proposal.
                  </p>
                </div>
                <span className="rounded bg-muted px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                  Working Total: {money(workingResult?.total ?? 0)}
                </span>
              </div>

              {/* 1. Base Package Selector */}
              <div className="mt-4">
                <label className="text-[12.5px] font-medium text-foreground">Base Package</label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {ws.packages.filter((p) => !p.archived).map((pkg) => {
                    const isSelected = workingConfig.basePackageId === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        onClick={() =>
                          setWorkingConfig((prev) => ({
                            ...prev,
                            basePackageId: pkg.id,
                            selectedAddonIds: prev.selectedAddonIds.filter((id) =>
                              pkg.addons.some((a) => a.id === id),
                            ),
                          }))
                        }
                        className={`cursor-pointer rounded-lg border p-3 text-[13px] transition-colors ${
                          isSelected
                            ? "border-brand bg-brand-soft/20 text-foreground"
                            : "border-border hover:border-border/80"
                        }`}
                      >
                        <div className="flex justify-between font-medium">
                          <span>{pkg.name}</span>
                          <span className="text-brand">{money(pkg.price)}</span>
                        </div>
                        <p className="mt-1 text-[11.5px] text-muted-foreground line-clamp-1">
                          {pkg.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Package Add-ons */}
              {selectedBasePkg && selectedBasePkg.addons.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <label className="text-[12.5px] font-medium text-foreground">
                    {selectedBasePkg.name} Add-ons
                  </label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {selectedBasePkg.addons.map((addon) => {
                      const isChecked = workingConfig.selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className="flex cursor-pointer items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px] hover:border-brand/50"
                        >
                          <span className="flex items-center gap-2">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(c) => {
                                setWorkingConfig((prev) => ({
                                  ...prev,
                                  selectedAddonIds: c
                                    ? [...prev.selectedAddonIds, addon.id]
                                    : prev.selectedAddonIds.filter((id) => id !== addon.id),
                                }));
                              }}
                            />
                            <span>{addon.name}</span>
                          </span>
                          <span className="font-medium text-muted-foreground">{money(addon.price)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Catalog Products & Quantities */}
              <div className="mt-5 border-t border-border pt-4">
                <label className="text-[12.5px] font-medium text-foreground">
                  Additional Products & Extras
                </label>
                <div className="mt-2 space-y-2">
                  {ws.products.filter((p) => p.active).map((p) => {
                    const isSelected = workingConfig.selectedProductIds.includes(p.id);
                    const qty = workingConfig.productQuantities[p.id] ?? 1;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]"
                      >
                        <div className="flex items-center gap-2.5">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(c) => {
                              setWorkingConfig((prev) => ({
                                ...prev,
                                selectedProductIds: c
                                  ? [...prev.selectedProductIds, p.id]
                                  : prev.selectedProductIds.filter((id) => id !== p.id),
                              }));
                            }}
                          />
                          <div>
                            <span className="font-medium text-foreground">{p.name}</span>
                            <span className="ml-2 text-[11.5px] text-muted-foreground">
                              {money(p.price)} / {p.unit}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="rounded border border-border p-1 hover:bg-muted"
                              onClick={() => {
                                const next = Math.max(1, qty - 1);
                                setWorkingConfig((prev) => ({
                                  ...prev,
                                  productQuantities: { ...prev.productQuantities, [p.id]: next },
                                }));
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-8 text-center font-mono font-medium">{qty}</span>
                            <button
                              type="button"
                              className="rounded border border-border p-1 hover:bg-muted"
                              onClick={() => {
                                const next = Math.min(9999, qty + 1);
                                setWorkingConfig((prev) => ({
                                  ...prev,
                                  productQuantities: { ...prev.productQuantities, [p.id]: next },
                                }));
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. Manual Charges / Discounts */}
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-[12.5px] font-medium text-foreground">
                    Manual Adjustments
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11.5px]"
                    onClick={() => {
                      const newAdj: ManualQuoteAdjustment = {
                        id: `adj_${Date.now()}`,
                        label: "Custom Adjustment",
                        amount: 100,
                        quantity: 1,
                        kind: "charge",
                      };
                      setWorkingConfig((prev) => ({
                        ...prev,
                        manualAdjustments: [...prev.manualAdjustments, newAdj],
                      }));
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add Adjustment
                  </Button>
                </div>

                {workingConfig.manualAdjustments.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {workingConfig.manualAdjustments.map((adj, idx) => (
                      <div
                        key={adj.id}
                        className="flex items-center gap-2 rounded-lg border border-border p-2 text-[12px]"
                      >
                        <Input
                          className="h-7 flex-1 text-[12px]"
                          value={adj.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWorkingConfig((prev) => {
                              const list = [...prev.manualAdjustments];
                              list[idx] = { ...adj, label: val };
                              return { ...prev, manualAdjustments: list };
                            });
                          }}
                          placeholder="Adjustment label"
                        />
                        <Input
                          type="number"
                          className="h-7 w-20 text-[12px] font-mono"
                          value={adj.amount}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setWorkingConfig((prev) => {
                              const list = [...prev.manualAdjustments];
                              list[idx] = { ...adj, amount: val };
                              return { ...prev, manualAdjustments: list };
                            });
                          }}
                          placeholder="Amount"
                        />
                        <Select
                          value={adj.kind}
                          onValueChange={(k) => {
                            setWorkingConfig((prev) => {
                              const list = [...prev.manualAdjustments];
                              list[idx] = { ...adj, kind: k as "charge" | "discount" };
                              return { ...prev, manualAdjustments: list };
                            });
                          }}
                        >
                          <SelectTrigger className="h-7 w-24 text-[11.5px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="charge">Charge</SelectItem>
                            <SelectItem value="discount">Discount</SelectItem>
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setWorkingConfig((prev) => ({
                              ...prev,
                              manualAdjustments: prev.manualAdjustments.filter((a) => a.id !== adj.id),
                            }));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Proposal Note */}
              <div className="mt-5 border-t border-border pt-4">
                <label className="text-[12.5px] font-medium text-foreground">
                  Custom Proposal Notes (shown to customer)
                </label>
                <Textarea
                  className="mt-1.5 min-h-[70px] text-[12.5px]"
                  value={proposalNotes}
                  onChange={(e) => setProposalNotes(e.target.value)}
                  placeholder="E.g. Includes waived setup fee for weekend booking."
                />
              </div>
            </div>

            {/* Submitted Answers */}
            <div className="qf-card">
              <div className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">
                Customer Answers
              </div>
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

            {/* Internal Notes */}
            <div className="qf-card p-4">
              <p className="qf-label mb-2">Team Internal Notes</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal team notes (not visible to customer)…"
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Side-by-Side Quote Comparison */}
          <div className="space-y-6">
            {/* Working Proposal Quote */}
            {workingResult && (
              <div className="rounded-xl border border-brand/40 bg-card p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-[14px] font-semibold text-brand">
                    Proposed Working Quote
                  </h3>
                  <span className="text-[18px] font-bold text-foreground tabular-nums">
                    {money(workingResult.total)}
                  </span>
                </div>
                <div className="mt-3">
                  <PriceSummary
                    lines={workingResult.lines}
                    subtotal={workingResult.subtotal}
                    discount={workingResult.discount}
                    total={workingResult.total}
                    title="Configured Line Items"
                  />
                </div>
              </div>
            )}

            {/* Original Submitted Quote (Frozen Snapshot) */}
            {submittedResult && (
              <div className="rounded-xl border border-border bg-muted/30 p-5">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="text-[13.5px] font-semibold text-muted-foreground">
                      Original Submitted Quote (Frozen)
                    </h3>
                    <p className="text-[11.5px] text-muted-foreground">
                      Captured at enquiry submission: {enquiry.createdAt}
                    </p>
                  </div>
                  <span className="text-[16px] font-semibold text-muted-foreground tabular-nums">
                    {money(submittedResult.total)}
                  </span>
                </div>
                <div className="mt-3 opacity-90">
                  <PriceSummary
                    lines={submittedResult.lines}
                    subtotal={submittedResult.subtotal}
                    discount={submittedResult.discount}
                    total={submittedResult.total}
                    title="Original Submitted Lines"
                  />
                </div>
              </div>
            )}

            {/* Proposal Route Navigation */}
            <Link
              to="/proposals/$enquiryId"
              params={{ enquiryId: enquiry.id }}
              className="qf-card flex items-center justify-between p-4 text-[13px] font-medium hover:border-brand/40"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand" />
                View Full Proposal Document
              </span>
              <span className="text-muted-foreground">
                Rev {ws.proposals.find((p) => p.enquiryId === enquiry.id)?.revision ?? 1} →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
