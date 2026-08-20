import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Logo, StatusPill } from "@/components/quoteflow/AppShell";
import { RuleList } from "@/components/quoteflow/RuleBuilder";
import { FlowPreview, PriceSummary } from "@/components/quoteflow/FlowPreview";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { uid } from "@/lib/quoteflow/seed";
import { flowVariables, money, runEngine, slugToVariable } from "@/lib/quoteflow/engine";
import type { CalcOperator, ComponentType, Flow, FlowComponent } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  ArrowLeft,
  Copy,
  GripVertical,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/flows/$flowId")({
  head: () => ({
    meta: [
      { title: "Flow builder — QuoteFlow" },
      { name: "description", content: "Add questions, variables, rules and pricing to your enquiry flow." },
      { property: "og:title", content: "Flow builder — QuoteFlow" },
      { property: "og:description", content: "Add questions, variables, rules and pricing to your enquiry flow." },
    ],
  }),
  component: FlowBuilder,
});

const library: { group: string; items: { type: ComponentType; label: string; supported: boolean }[] }[] = [
  {
    group: "Questions",
    items: [
      { type: "text", label: "Text", supported: true },
      { type: "number", label: "Number", supported: true },
      { type: "email", label: "Email", supported: false },
      { type: "phone", label: "Phone", supported: false },
      { type: "dropdown", label: "Dropdown", supported: true },
      { type: "multiselect", label: "Multi-select", supported: true },
      { type: "radio", label: "Radio", supported: false },
      { type: "checkbox", label: "Checkbox", supported: false },
      { type: "date", label: "Date", supported: false },
      { type: "file", label: "File Upload", supported: false },
    ],
  },
  {
    group: "Business",
    items: [
      { type: "variable", label: "Variable", supported: true },
      { type: "product-selector", label: "Product Selector", supported: false },
      { type: "package-selector", label: "Package Selector", supported: false },
      { type: "recommendation", label: "Recommendation", supported: true },
      { type: "calculation", label: "Calculation", supported: true },
      { type: "score", label: "Score", supported: false },
    ],
  },
  {
    group: "Output",
    items: [
      { type: "price-summary", label: "Price Summary", supported: true },
      { type: "proposal", label: "Proposal", supported: false },
      { type: "crm-action", label: "CRM Action", supported: false },
    ],
  },
];

const typeLabel = (t: ComponentType) =>
  library.flatMap((g) => g.items).find((i) => i.type === t)?.label ?? t;

function makeComponent(type: ComponentType): FlowComponent {
  const base: FlowComponent = { id: uid("c"), type, label: typeLabel(type) };
  if (["price-summary", "proposal", "crm-action", "recommendation"].includes(type)) return base;
  if (type === "calculation") {
    return {
      ...base,
      label: "New Calculation",
      calculation: {
        id: uid("calc"),
        name: "New Calculation",
        resultVariable: "new_calculation",
        terms: [{ id: uid("t"), kind: "variable", variable: "" }],
      },
    };
  }
  const comp: FlowComponent = { ...base, label: `New ${typeLabel(type)}`, variable: slugToVariable(`new_${typeLabel(type)}`), required: false };
  if (type === "dropdown" || type === "multiselect") {
    comp.options = [
      { id: uid("o"), label: "Option one", value: "option_one" },
      { id: uid("o"), label: "Option two", value: "option_two" },
    ];
  }
  return comp;
}

function FlowBuilder() {
  const { flowId } = Route.useParams();
  const ws = useWorkspace();
  const { upsertFlow } = useActions();
  const flow = ws.flows.find((f) => f.id === flowId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("build");
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!flow) {
    return (
      <AppShell>
        <div className="p-10 text-[14px] text-muted-foreground">
          This flow no longer exists. <Link to="/flows" className="text-brand">Back to flows</Link>
        </div>
      </AppShell>
    );
  }

  const save = (patch: Partial<Flow>) => upsertFlow({ ...flow, ...patch });
  const selected = flow.components.find((c) => c.id === selectedId) ?? null;

  const addComponent = (type: ComponentType, index?: number) => {
    const comp = makeComponent(type);
    const next = [...flow.components];
    next.splice(index ?? next.length, 0, comp);
    save({ components: next });
    setSelectedId(comp.id);
  };

  const updateComponent = (c: FlowComponent) =>
    save({ components: flow.components.map((x) => (x.id === c.id ? c : x)) });

  const demoResult = runEngine({
    flow,
    answers: ws.enquiries.find((e) => e.flowId === flow.id)?.answers ?? {},
    products: ws.products,
    packages: ws.packages,
  });

  return (
    <AppShell>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/flows">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold">{flow.name}</h1>
            <StatusPill status={flow.status} />
          </div>
          <p className="truncate text-[12px] text-muted-foreground">{flow.description}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-8">
              <TabsTrigger value="build" className="text-[12.5px]">
                Build
              </TabsTrigger>
              <TabsTrigger value="logic" className="text-[12.5px]">
                Logic
              </TabsTrigger>
              <TabsTrigger value="pricing" className="text-[12.5px]">
                Pricing
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Play className="mr-1 h-3.5 w-3.5" /> Preview
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsContent value="build" className="m-0 flex min-h-0 flex-1">
          <div className="grid w-full grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
            {/* LEFT: component library */}
            <div className="hidden border-r border-border bg-sidebar/60 p-3 lg:block">
              <p className="qf-label mb-2">Components</p>
              <div className="space-y-4">
                {library.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{g.group}</p>
                    <div className="space-y-1">
                      {g.items.map((i) => (
                        <button
                          key={i.type}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/qf-type", i.type)}
                          onClick={() => addComponent(i.type)}
                          className={cn(
                            "flex w-full cursor-grab items-center justify-between rounded-md border border-transparent bg-card px-2 py-1.5 text-left text-[12.5px] shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition-colors hover:border-brand/40",
                            !i.supported && "opacity-60",
                          )}
                        >
                          {i.label}
                          {!i.supported && <span className="text-[10px] text-muted-foreground">soon</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CENTER: canvas */}
            <div
              className="min-h-[60vh] space-y-2 bg-background p-5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const t = e.dataTransfer.getData("text/qf-type") as ComponentType;
                if (t) addComponent(t);
              }}
            >
              {flow.components.length === 0 && (
                <div className="grid h-48 place-items-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">
                  Drag a component here to start building.
                </div>
              )}
              {flow.components.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "qf-card group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                    selectedId === c.id && "border-brand/60 ring-1 ring-brand/20",
                  )}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium">{c.label}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        {typeLabel(c.type)}
                      </span>
                      {c.required && <span className="text-[10.5px] text-brand">Required</span>}
                    </div>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {c.description || (c.variable ? `Variable: ${c.variable}` : "Output component")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        save({ components: [...flow.components, { ...structuredClone(c), id: uid("c") }] });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        save({ components: flow.components.filter((x) => x.id !== c.id) });
                        if (selectedId === c.id) setSelectedId(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* RIGHT: properties */}
            <div className="border-l border-border bg-sidebar/40 p-4">
              {selected ? (
                <PropertiesPanel
                  key={selected.id}
                  flow={flow}
                  component={selected}
                  onChange={updateComponent}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <div>
                  <p className="qf-label">Variables</p>
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    Every question becomes a variable your rules and calculations can use.
                  </p>
                  <ul className="mt-3 space-y-1">
                    {flowVariables(flow).map((v) => (
                      <li key={v.variable} className="flex items-center justify-between rounded-md bg-card px-2 py-1.5 text-[12.5px]">
                        <span>{v.label}</span>
                        <span className="font-mono text-[11px] text-brand">{v.variable}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="logic" className="m-0 p-6">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold">Logic</h2>
            <p className="text-[13px] text-muted-foreground">
              If this, then that. Rules run top to bottom every time a customer answers.
            </p>
          </div>
          <RuleList flow={flow} onChange={(rules) => save({ rules })} />
        </TabsContent>

        <TabsContent value="pricing" className="m-0 grid gap-5 p-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="qf-card p-4">
              <p className="qf-label">Base package</p>
              <Select value={flow.basePackageId ?? "none"} onValueChange={(v) => save({ basePackageId: v === "none" ? undefined : v })}>
                <SelectTrigger className="mt-2 h-9 max-w-sm text-[13px]">
                  <SelectValue placeholder="No base package" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No base package</SelectItem>
                  {ws.packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {money(p.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {flow.components
              .filter((c) => c.type === "calculation" && c.calculation)
              .map((c) => (
                <CalculationCard key={c.id} flow={flow} component={c} onChange={updateComponent} />
              ))}

            <Button variant="outline" size="sm" onClick={() => addComponent("calculation")}>
              <Plus className="mr-1 h-4 w-4" /> Add calculation
            </Button>
          </div>

          <PriceSummary
            title="Example quote"
            lines={demoResult.lines}
            subtotal={demoResult.subtotal}
            discount={demoResult.discount}
            total={demoResult.total}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <Logo />
            <span className="text-[12px] text-muted-foreground">Customer preview</span>
          </div>
          <FlowPreview flow={flow} />
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function PropertiesPanel({
  flow,
  component,
  onChange,
  onClose,
}: {
  flow: Flow;
  component: FlowComponent;
  onChange: (c: FlowComponent) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<FlowComponent>) => onChange({ ...component, ...patch });
  const hasOptions = component.type === "dropdown" || component.type === "multiselect" || component.type === "radio";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="qf-label">{typeLabel(component.type)} properties</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Field label="Label">
        <Input
          className="h-8 bg-card text-[13px]"
          value={component.label}
          onChange={(e) =>
            set({
              label: e.target.value,
              variable: component.variable ? slugToVariable(e.target.value) : component.variable,
            })
          }
        />
      </Field>

      <Field label="Description">
        <Textarea
          className="min-h-[60px] bg-card text-[13px]"
          value={component.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>

      {component.variable !== undefined && (
        <Field label="Variable name" hint="Used by rules and calculations">
          <Input
            className="h-8 bg-card font-mono text-[12.5px] text-brand"
            value={component.variable}
            onChange={(e) => set({ variable: slugToVariable(e.target.value) })}
          />
        </Field>
      )}

      {component.variable !== undefined && (
        <div className="flex items-center justify-between rounded-md bg-card px-2.5 py-2">
          <span className="text-[13px]">Required</span>
          <Switch checked={!!component.required} onCheckedChange={(v) => set({ required: v })} />
        </div>
      )}

      {component.type === "number" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Minimum">
            <Input
              type="number"
              className="h-8 bg-card text-[13px]"
              value={component.min ?? ""}
              onChange={(e) => set({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
          <Field label="Maximum">
            <Input
              type="number"
              className="h-8 bg-card text-[13px]"
              value={component.max ?? ""}
              onChange={(e) => set({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Unit">
              <Input
                className="h-8 bg-card text-[13px]"
                value={component.unit ?? ""}
                placeholder="people"
                onChange={(e) => set({ unit: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {hasOptions && (
        <div>
          <p className="qf-label mb-1.5">Options</p>
          <div className="space-y-1.5">
            {(component.options ?? []).map((o) => (
              <div key={o.id} className="flex items-center gap-1.5">
                <Input
                  className="h-8 bg-card text-[12.5px]"
                  value={o.label}
                  onChange={(e) =>
                    set({
                      options: (component.options ?? []).map((x) =>
                        x.id === o.id ? { ...x, label: e.target.value, value: slugToVariable(e.target.value) } : x,
                      ),
                    })
                  }
                />
                <Input
                  className="h-8 w-[110px] bg-card font-mono text-[11.5px] text-muted-foreground"
                  value={o.value}
                  onChange={(e) =>
                    set({
                      options: (component.options ?? []).map((x) => (x.id === o.id ? { ...x, value: e.target.value } : x)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => set({ options: (component.options ?? []).filter((x) => x.id !== o.id) })}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 text-[12px] text-brand hover:text-brand"
            onClick={() =>
              set({ options: [...(component.options ?? []), { id: uid("o"), label: "New option", value: "new_option" }] })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add option
          </Button>
        </div>
      )}

      {component.type === "calculation" && component.calculation && (
        <CalculationCard flow={flow} component={component} onChange={onChange} compact />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="qf-label mb-1">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CalculationCard({
  flow,
  component,
  onChange,
  compact,
}: {
  flow: Flow;
  component: FlowComponent;
  onChange: (c: FlowComponent) => void;
  compact?: boolean;
}) {
  const calc = component.calculation!;
  const vars = flowVariables(flow).filter((v) => v.variable !== calc.resultVariable);
  const ops: CalcOperator[] = ["+", "-", "×", "÷"];

  const setCalc = (patch: Partial<typeof calc>) =>
    onChange({ ...component, calculation: { ...calc, ...patch }, label: patch.name ?? component.label });

  return (
    <div className={cn("qf-card p-4", compact && "bg-card")}>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 max-w-[220px] text-[13px]"
          value={calc.name}
          onChange={(e) => setCalc({ name: e.target.value, resultVariable: slugToVariable(e.target.value) })}
        />
        <span className="font-mono text-[11px] text-brand">{calc.resultVariable}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {calc.terms.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2">
            {i > 0 && (
              <Select
                value={t.operator ?? "+"}
                onValueChange={(v) =>
                  setCalc({ terms: calc.terms.map((x) => (x.id === t.id ? { ...x, operator: v as CalcOperator } : x)) })
                }
              >
                <SelectTrigger className="h-8 w-[58px] justify-center text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ops.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {t.kind === "variable" ? (
              <Select
                value={t.variable ?? ""}
                onValueChange={(v) =>
                  setCalc({
                    terms: calc.terms.map((x) =>
                      x.id === t.id ? (v === "__number" ? { ...x, kind: "number", number: 0 } : { ...x, variable: v }) : x,
                    ),
                  })
                }
              >
                <SelectTrigger className="h-8 w-[170px] text-[12.5px]">
                  <SelectValue placeholder="Choose value" />
                </SelectTrigger>
                <SelectContent>
                  {vars.map((v) => (
                    <SelectItem key={v.variable} value={v.variable}>
                      {v.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="__number">Fixed number…</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                type="number"
                className="h-8 w-[110px] text-[12.5px]"
                value={t.number ?? 0}
                onChange={(e) =>
                  setCalc({ terms: calc.terms.map((x) => (x.id === t.id ? { ...x, number: Number(e.target.value) } : x)) })
                }
              />
            )}
            {calc.terms.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCalc({ terms: calc.terms.filter((x) => x.id !== t.id) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        <span className="text-[14px] text-muted-foreground">=</span>
        <span className="rounded-md bg-brand-soft px-2.5 py-1 text-[13px] font-medium text-brand">{calc.name}</span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 h-7 text-[12px] text-brand hover:text-brand"
        onClick={() => setCalc({ terms: [...calc.terms, { id: uid("t"), kind: "variable", variable: "", operator: "+" }] })}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add step
      </Button>
    </div>
  );
}