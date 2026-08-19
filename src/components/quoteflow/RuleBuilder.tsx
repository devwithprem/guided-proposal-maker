import { useState } from "react";
import type { Action, ActionType, Flow, Operator, Rule } from "@/lib/quoteflow/types";
import { actionLabels, flowVariables, money, operatorLabels, runEngine } from "@/lib/quoteflow/engine";
import type { Answers } from "@/lib/quoteflow/engine";
import { uid } from "@/lib/quoteflow/seed";
import { useWorkspace } from "@/lib/quoteflow/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Copy, Plus, Trash2, Check, FlaskConical, X } from "lucide-react";

const operators: Operator[] = [
  "equals",
  "not_equals",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "is_empty",
  "is_not_empty",
];

const actionTypes: ActionType[] = [
  "show",
  "hide",
  "recommend",
  "add_to_quote",
  "remove_from_quote",
  "set_value",
  "add_fee",
  "apply_discount",
  "set_score",
];

const needsTarget = (t: ActionType) => ["show", "hide", "recommend", "add_to_quote", "remove_from_quote"].includes(t);
const needsAmount = (t: ActionType) => ["add_fee", "apply_discount", "set_score"].includes(t);

export function newRule(index: number): Rule {
  return {
    id: uid("r"),
    name: `Rule ${String(index + 1).padStart(2, "0")}`,
    match: "all",
    active: true,
    conditions: [{ id: uid("c"), variable: "", operator: "equals", value: "" }],
    actions: [{ id: uid("a"), type: "recommend", targetKind: "product" }],
  };
}

function ActionSummary({ action, flow }: { action: Action; flow: Flow }) {
  const ws = useWorkspace();
  const target =
    action.targetKind === "product"
      ? ws.products.find((p) => p.id === action.targetId)?.name
      : action.targetKind === "package"
        ? ws.packages.find((p) => p.id === action.targetId)?.name
        : flow.components.find((c) => c.id === action.targetId)?.label;
  return (
    <span>
      <span className="font-medium">{actionLabels[action.type]}</span>{" "}
      {target ?? action.label ?? action.variable ?? ""}
      {needsAmount(action.type) && action.amount !== undefined ? ` ${action.type === "set_score" ? action.amount : money(action.amount)}` : ""}
      {action.type === "set_value" && action.value ? ` → ${action.value}` : ""}
    </span>
  );
}

function RuleEditor({ rule, flow, onChange }: { rule: Rule; flow: Flow; onChange: (r: Rule) => void }) {
  const ws = useWorkspace();
  const vars = flowVariables(flow);

  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={rule.name}
          onChange={(e) => set({ name: e.target.value })}
          className="h-8 max-w-[240px] bg-card text-[13px]"
          placeholder="Rule name"
        />
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          Active <Switch checked={rule.active} onCheckedChange={(v) => set({ active: v })} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="qf-label">When</span>
          <Select value={rule.match} onValueChange={(v) => set({ match: v as Rule["match"] })}>
            <SelectTrigger className="h-7 w-[210px] bg-card text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL conditions must match</SelectItem>
              <SelectItem value="any">ANY condition can match</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {rule.conditions.map((c, i) => {
            const variable = vars.find((v) => v.variable === c.variable);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="w-9 text-[11px] font-semibold uppercase text-muted-foreground">
                  {i === 0 ? "If" : rule.match === "all" ? "And" : "Or"}
                </span>
                <Select
                  value={c.variable}
                  onValueChange={(v) =>
                    set({ conditions: rule.conditions.map((x) => (x.id === c.id ? { ...x, variable: v } : x)) })
                  }
                >
                  <SelectTrigger className="h-8 w-[190px] bg-card text-[12.5px]">
                    <SelectValue placeholder="Choose a question" />
                  </SelectTrigger>
                  <SelectContent>
                    {vars.map((v) => (
                      <SelectItem key={v.variable} value={v.variable}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={c.operator}
                  onValueChange={(v) =>
                    set({
                      conditions: rule.conditions.map((x) => (x.id === c.id ? { ...x, operator: v as Operator } : x)),
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-[190px] bg-card text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((o) => (
                      <SelectItem key={o} value={o}>
                        {operatorLabels[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!["is_empty", "is_not_empty"].includes(c.operator) &&
                  (variable?.options?.length ? (
                    <Select
                      value={c.value}
                      onValueChange={(v) =>
                        set({ conditions: rule.conditions.map((x) => (x.id === c.id ? { ...x, value: v } : x)) })
                      }
                    >
                      <SelectTrigger className="h-8 w-[160px] bg-card text-[12.5px]">
                        <SelectValue placeholder="Value" />
                      </SelectTrigger>
                      <SelectContent>
                        {variable.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={c.value}
                      onChange={(e) =>
                        set({
                          conditions: rule.conditions.map((x) => (x.id === c.id ? { ...x, value: e.target.value } : x)),
                        })
                      }
                      placeholder="Value"
                      className="h-8 w-[160px] bg-card text-[12.5px]"
                    />
                  ))}
                {rule.conditions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => set({ conditions: rule.conditions.filter((x) => x.id !== c.id) })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] text-brand hover:text-brand"
            onClick={() =>
              set({ conditions: [...rule.conditions, { id: uid("c"), variable: "", operator: "equals", value: "" }] })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Condition
          </Button>
        </div>
      </div>

      <div>
        <span className="qf-label">Then</span>
        <div className="mt-2 space-y-2">
          {rule.actions.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2">
              <Select
                value={a.type}
                onValueChange={(v) =>
                  set({ actions: rule.actions.map((x) => (x.id === a.id ? { ...x, type: v as ActionType } : x)) })
                }
              >
                <SelectTrigger className="h-8 w-[190px] bg-card text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actionTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {actionLabels[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {needsTarget(a.type) && (
                <Select
                  value={a.targetId ?? ""}
                  onValueChange={(v) => {
                    const kind = v.startsWith("pk_") ? "package" : v.startsWith("p_") ? "product" : "question";
                    set({
                      actions: rule.actions.map((x) => (x.id === a.id ? { ...x, targetId: v, targetKind: kind } : x)),
                    });
                  }}
                >
                  <SelectTrigger className="h-8 w-[230px] bg-card text-[12.5px]">
                    <SelectValue placeholder="Choose what to apply" />
                  </SelectTrigger>
                  <SelectContent>
                    {["show", "hide"].includes(a.type)
                      ? flow.components.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))
                      : [
                          ...ws.products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} — {money(p.price)}
                            </SelectItem>
                          )),
                          ...ws.packages.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} — {money(p.price)}
                            </SelectItem>
                          )),
                        ]}
                  </SelectContent>
                </Select>
              )}

              {needsAmount(a.type) && (
                <>
                  {a.type !== "set_score" && (
                    <Input
                      value={a.label ?? ""}
                      placeholder={a.type === "add_fee" ? "Fee name" : "Discount name"}
                      onChange={(e) =>
                        set({ actions: rule.actions.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)) })
                      }
                      className="h-8 w-[150px] bg-card text-[12.5px]"
                    />
                  )}
                  <Input
                    type="number"
                    value={a.amount ?? ""}
                    placeholder="Amount"
                    onChange={(e) =>
                      set({
                        actions: rule.actions.map((x) => (x.id === a.id ? { ...x, amount: Number(e.target.value) } : x)),
                      })
                    }
                    className="h-8 w-[110px] bg-card text-[12.5px]"
                  />
                </>
              )}

              {a.type === "set_value" && (
                <>
                  <Select
                    value={a.variable ?? ""}
                    onValueChange={(v) =>
                      set({ actions: rule.actions.map((x) => (x.id === a.id ? { ...x, variable: v } : x)) })
                    }
                  >
                    <SelectTrigger className="h-8 w-[180px] bg-card text-[12.5px]">
                      <SelectValue placeholder="Choose variable" />
                    </SelectTrigger>
                    <SelectContent>
                      {vars.map((v) => (
                        <SelectItem key={v.variable} value={v.variable}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={a.value ?? ""}
                    placeholder="Value"
                    onChange={(e) =>
                      set({ actions: rule.actions.map((x) => (x.id === a.id ? { ...x, value: e.target.value } : x)) })
                    }
                    className="h-8 w-[140px] bg-card text-[12.5px]"
                  />
                </>
              )}

              {rule.actions.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => set({ actions: rule.actions.filter((x) => x.id !== a.id) })}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] text-brand hover:text-brand"
            onClick={() => set({ actions: [...rule.actions, { id: uid("a"), type: "recommend", targetKind: "product" }] })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Action
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RuleList({ flow, onChange }: { flow: Flow; onChange: (rules: Rule[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const vars = flowVariables(flow).filter((v) => v.type !== "calculation");

  const update = (r: Rule) => onChange(flow.rules.map((x) => (x.id === r.id ? r : x)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            const r = newRule(flow.rules.length);
            onChange([...flow.rules, r]);
            setEditing(r.id);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add Rule
        </Button>
        <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
          <FlaskConical className="mr-1 h-4 w-4" /> Test Rules
        </Button>
      </div>

      {flow.rules.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          No rules yet. Rules decide what to recommend, what to add and what it costs.
        </p>
      )}

      {flow.rules.map((rule, i) => (
        <div key={rule.id} className="qf-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                RULE {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13.5px] font-medium">{rule.name}</span>
              <span
                className={
                  rule.active
                    ? "rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand"
                    : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                }
              >
                {rule.active ? "Active" : "Paused"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setEditing(editing === rule.id ? null : rule.id)}>
                {editing === rule.id ? "Done" : "Edit"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange([...flow.rules, { ...structuredClone(rule), id: uid("r"), name: `${rule.name} copy` }])}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(flow.rules.filter((x) => x.id !== rule.id))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {editing === rule.id ? (
            <div className="p-3">
              <RuleEditor rule={rule} flow={flow} onChange={update} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
              <span className="qf-label">If</span>
              {rule.conditions.map((c, ci) => {
                const v = flowVariables(flow).find((x) => x.variable === c.variable);
                const valueLabel = v?.options?.find((o) => o.value === c.value)?.label ?? c.value;
                return (
                  <span key={c.id} className="flex items-center gap-1.5">
                    {ci > 0 && (
                      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                        {rule.match === "all" ? "and" : "or"}
                      </span>
                    )}
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">{v?.label ?? c.variable}</span>
                    <span className="text-muted-foreground">{operatorLabels[c.operator]}</span>
                    {!["is_empty", "is_not_empty"].includes(c.operator) && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">{valueLabel}</span>
                    )}
                  </span>
                );
              })}
              <span className="qf-label">Then</span>
              {rule.actions.map((a) => (
                <span key={a.id} className="rounded bg-brand-soft px-2 py-0.5 text-[12.5px] text-brand">
                  <ActionSummary action={a} flow={flow} />
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      <RuleTester open={testOpen} onOpenChange={setTestOpen} flow={flow} vars={vars} />
    </div>
  );
}

function RuleTester({
  open,
  onOpenChange,
  flow,
  vars,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flow: Flow;
  vars: ReturnType<typeof flowVariables>;
}) {
  const ws = useWorkspace();
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<ReturnType<typeof runEngine> | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test your rules</DialogTitle>
          <DialogDescription>Enter sample answers and see exactly what a customer would get.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
          {vars.map((v) => (
            <div key={v.variable} className="grid grid-cols-[140px_1fr] items-center gap-3">
              <label className="text-[13px] text-muted-foreground">{v.label}</label>
              {v.options?.length ? (
                <Select
                  value={String(answers[v.variable] ?? "")}
                  onValueChange={(val) => setAnswers((a) => ({ ...a, [v.variable]: val }))}
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {v.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8 text-[13px]"
                  value={String(answers[v.variable] ?? "")}
                  onChange={(e) => setAnswers((a) => ({ ...a, [v.variable]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        {result && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
            {result.messages.length === 0 ? (
              <p className="text-muted-foreground">No rules matched these answers.</p>
            ) : (
              <ul className="space-y-1">
                {result.messages.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-brand" /> {m}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t border-border pt-2 font-medium">Quote total {money(result.total)}</p>
          </div>
        )}
        <DialogFooter>
          <Button
            onClick={() =>
              setResult(runEngine({ flow, answers, products: ws.products, packages: ws.packages }))
            }
          >
            Run Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}